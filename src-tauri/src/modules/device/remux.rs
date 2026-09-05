/// Split an Annex-B byte stream into individual NAL unit byte strings (without
/// the start codes). Recognizes both the 4-byte `00 00 00 01` start code and
/// the 3-byte `00 00 01` start code per the H.264 spec. Pure function so the
/// parser is unit-testable without a live scrcpy socket.
fn split_nal_units(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut nals = Vec::new();
    let mut i = 0usize;
    let mut unit_start: Option<usize> = None;
    while i + 2 < bytes.len() {
        let is3 = bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 0x01;
        let is4 = i + 3 < bytes.len() && bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 0 && bytes[i + 3] == 0x01;
        if is4 {
            push_nonempty(&mut nals, bytes, unit_start, i);
            unit_start = Some(i + 4);
            i += 4;
        } else if is3 {
            push_nonempty(&mut nals, bytes, unit_start, i);
            unit_start = Some(i + 3);
            i += 3;
        } else {
            i += 1;
        }
    }
    push_nonempty(&mut nals, bytes, unit_start, bytes.len());
    nals
}

fn push_nonempty(nals: &mut Vec<Vec<u8>>, bytes: &[u8], start: Option<usize>, end: usize) {
    if let Some(start) = start {
        if start < end {
            nals.push(bytes[start..end].to_vec());
        }
    }
}

/// Pop complete NAL units from the front of `buf`, leaving the trailing
/// in-flight unit (bytes from the last start code onward, *including* its
/// start code) in `buf` for the next read. The streaming read loop uses this
/// because NALs may be split across `read()` calls. Initialize `buf` empty;
/// append each chunk, then call this to drain what is provably complete.
///
/// Only NALs bounded by two start codes are considered complete; with fewer
/// than two start codes nothing is drained (the whole `buf` is retained).
fn drain_complete_nals(buf: &mut Vec<u8>) -> Vec<Vec<u8>> {
    let mut sc: Vec<(usize, usize)> = Vec::new();
    let mut i = 0usize;
    while i + 2 < buf.len() {
        let is4 =
            i + 3 < buf.len() && buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 0 && buf[i + 3] == 0x01;
        let is3 = !is4 && buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 0x01;
        if is4 {
            sc.push((i, 4));
            i += 4;
        } else if is3 {
            sc.push((i, 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    if sc.len() < 2 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(sc.len() - 1);
    for k in 0..sc.len() - 1 {
        let (p, l) = sc[k];
        let start = p + l;
        let end = sc[k + 1].0;
        if start < end {
            out.push(buf[start..end].to_vec());
        }
    }
    let tail = sc[sc.len() - 1].0;
    let keep = buf[tail..].to_vec();
    buf.clear();
    buf.extend_from_slice(&keep);
    out
}

/// fMP4 (fragmented MP4 / CMAF) muxer for a single Annex-B H.264 elementary
/// stream. v1 emits one `moof`+`mdat` per NAL. The init segment (`ftyp`+`moov`
/// with the `avcC` decoder config record) is built once from the first SPS+PPS
/// NALs the read loop sees.
///
/// CONTRACT (Rust↔TS codec-string handoff): the assembler encodes each output
/// frame as `[discriminator byte][payload]` (`FRAME_INIT` or `FRAME_MEDIA`,
/// see below). The init frame's payload is laid out as `[4-byte BE
/// length][UTF-8 codec string, e.g. "avc1.42c029"][ftyp+moov]`; a media
/// frame's payload is `[moof+mdat]`. See `modules/device/MsePlayer.ts::pushData`
/// for the consumer.
pub struct Fmp4Builder {
    codec_string: String,
    init_segment: Vec<u8>,
    sequence_number: u32,
    /// Cumulative `baseMediaDecodeTime` (units = track timescale, 1000 = ms).
    /// scrcpy `raw_stream=true` strips per-frame PTS, so we synthesize a
    /// monotonic timeline ourselves: each fragment adds the nominal duration.
    decode_time: u64,
}

/// `avc1.PPCCLL` from an SPS NAL (header byte + profile_idc +
/// constraint flags + level_idc). None when the NAL is too short to carry them.
pub fn codec_string_from_sps(sps: &[u8]) -> Option<String> {
    match sps {
        [_, profile, compat, level, ..] => Some(format!("avc1.{profile:02x}{compat:02x}{level:02x}")),
        _ => None,
    }
}

impl Fmp4Builder {
    /// `sps`/`pps` are raw NAL payloads without the Annex-B start code but with
    /// the 1-byte NAL header. None for parameter sets that cannot fill an avcC.
    pub fn from_parameter_sets(sps: &[u8], pps: &[u8]) -> Option<Self> {
        let codec_string = codec_string_from_sps(sps)?;
        let init_segment = build_init(sps, pps)?;
        Some(Self { codec_string, init_segment, sequence_number: 0, decode_time: 0 })
    }

    pub fn codec_string(&self) -> &str { &self.codec_string }

    pub fn init_segment(&self) -> &[u8] { &self.init_segment }

    /// Wrap a single NAL (no start code) in its own fMP4 media fragment
    /// (`moof`+`mdat`). The `mdat` body is `[u32 BE length][nal]` (AVC length
    /// prefix = 4 bytes, matching the `lengthSizeMinusOne=3` stored in `avcC`).
    /// `mfhd` carries a per-session incrementing `sequence_number`; `tfdt`
    /// carries an incrementing `baseMediaDecodeTime` so MSE can chain fragments.
    ///
    /// Sizes are constant for v1 (one sample per fragment, fixed box layout),
    /// so `trun`'s `data_offset` is a compile-time constant pointing at the
    /// `mdat` body start (just after the `mdat` box header).
    pub fn append_nal(&mut self, nal: &[u8]) -> Vec<u8> {
        self.sequence_number = self.sequence_number.wrapping_add(1);
        let seq = self.sequence_number;

        const NOMINAL_FRAME_DURATION_MS: u32 = 33;

        let mfhd = fullbox(b"mfhd", 0, 0, &seq.to_be_bytes());

        // default-base-is-moof (0x020000): trun data_offset is measured from the
        // first byte of the enclosing `moof` box, so no base_data_offset is needed.
        let mut tfhd_p = Vec::with_capacity(4);
        tfhd_p.extend_from_slice(&1u32.to_be_bytes()); // track_ID = 1
        let tfhd = fullbox(b"tfhd", 0, 0x020000, &tfhd_p);

        // tfdt (version 1, u64 baseMediaDecodeTime): the decode-time anchor MSE
        // needs to place this fragment on the timeline. Without it (and with a
        // zero duration) the <video> never paints — the original black-screen bug.
        let tfdt = fullbox(b"tfdt", 1, 0, &self.decode_time.to_be_bytes());

        // trun flags: data-offset-present (0x000001) | sample-duration-present
        // (0x000100) | sample-size-present (0x000200) = 0x000301.
        // moof = box(8)+mfhd(16)+traf[box(8)+tfhd(16)+tfdt(20)+trun(28)] = 96.
        const DATA_OFFSET: u32 = 104; // moof(96) + mdat header(8) → start of mdat body
        let mut trun_p = Vec::with_capacity(16);
        trun_p.extend_from_slice(&1u32.to_be_bytes()); // sample_count
        trun_p.extend_from_slice(&DATA_OFFSET.to_be_bytes()); // data_offset
        trun_p.extend_from_slice(&NOMINAL_FRAME_DURATION_MS.to_be_bytes()); // sample_duration (nominal, non-zero)
        trun_p.extend_from_slice(&((nal.len() as u32) + 4).to_be_bytes()); // sample_size (4-byte len + nal)
        let trun = fullbox(b"trun", 0, 0x000301, &trun_p);

        let mut traf_p = Vec::new();
        traf_p.extend_from_slice(&tfhd);
        traf_p.extend_from_slice(&tfdt);
        traf_p.extend_from_slice(&trun);
        let traf = box_(b"traf", &traf_p);

        let mut moof_p = Vec::new();
        moof_p.extend_from_slice(&mfhd);
        moof_p.extend_from_slice(&traf);
        let moof = box_(b"moof", &moof_p);

        // mdat body = [u32 BE nal_length][nal], matching avcC lengthSizeMinusOne=3.
        let mut mdat_p = Vec::with_capacity(4 + nal.len());
        mdat_p.extend_from_slice(&(nal.len() as u32).to_be_bytes());
        mdat_p.extend_from_slice(nal);
        let mdat = box_(b"mdat", &mdat_p);

        let mut out = Vec::with_capacity(moof.len() + mdat.len());
        out.extend_from_slice(&moof);
        out.extend_from_slice(&mdat);

        self.decode_time += NOMINAL_FRAME_DURATION_MS as u64;
        out
    }
}

use std::collections::VecDeque;

/// Slices that arrive before SPS+PPS are held for the post-bootstrap flush;
/// a stream that never produces a usable SPS must not grow that queue forever.
pub const MAX_PENDING_SLICES: usize = 256;

/// Byte-size counterpart to `MAX_PENDING_SLICES`: a handful of high-resolution
/// slices can blow past a lightweight memory budget well before the count cap.
pub const MAX_PENDING_BYTES: usize = 8 * 1024 * 1024;

/// NAL type (low 5 bits of the header byte) 5 = IDR (coded slice of an IDR
/// picture), the only slice type a decoder can start rendering from cleanly.
fn is_idr(nal: &[u8]) -> bool {
    nal.first().is_some_and(|b| b & 0x1F == 5)
}

/// Leading byte of every frame the assembler emits, so the frame carries its
/// own kind across the wire instead of a side channel keying frames by shape.
pub const FRAME_INIT: u8 = 0;
pub const FRAME_MEDIA: u8 = 1;

/// Decoded view over one encoded frame (`[discriminator][payload]`), borrowed
/// so decoding never copies. Not used by the read loop, which only forwards
/// the encoded bytes; this is the pure, testable contract for the format.
#[derive(Debug, PartialEq, Eq)]
pub enum Frame<'a> {
    /// `[u32 BE codec length][codec string][ftyp+moov]`, sent once.
    Init(&'a [u8]),
    /// `moof+mdat` for one NAL.
    Media(&'a [u8]),
}

/// Split a frame into its discriminator and payload. `None` for an empty
/// frame or a discriminator this build does not know.
pub fn decode_frame(frame: &[u8]) -> Option<Frame<'_>> {
    let (&discriminator, payload) = frame.split_first()?;
    match discriminator {
        FRAME_INIT => Some(Frame::Init(payload)),
        FRAME_MEDIA => Some(Frame::Media(payload)),
        _ => None,
    }
}

/// Turns the NAL sequence of one session into fMP4 segments: stores the first
/// usable SPS+PPS, emits the init segment once, then one media fragment per
/// slice. Malformed parameter sets are skipped, so the stream is simply not
/// bootstrapped yet rather than panicking or emitting a broken avcC.
#[derive(Default)]
pub struct StreamAssembler {
    /// Annex-B bytes accumulated across reads, not yet provably complete NALs.
    buf: Vec<u8>,
    builder: Option<Fmp4Builder>,
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
    pending: VecDeque<Vec<u8>>,
    pending_bytes: usize,
    warned_malformed: bool,
}

impl StreamAssembler {
    pub fn is_bootstrapped(&self) -> bool {
        self.builder.is_some()
    }

    /// Append newly read bytes to the framing buffer and process every NAL
    /// unit that is now provably complete (bounded by two start codes). A
    /// unit split across reads waits in the buffer for the next call.
    pub fn push_bytes(&mut self, bytes: &[u8], out: &mut Vec<Vec<u8>>) {
        self.buf.extend_from_slice(bytes);
        for nal in drain_complete_nals(&mut self.buf) {
            self.push(nal, out);
        }
    }

    /// End of stream: the trailing NAL has no closing start code to prove it
    /// complete, so split whatever is left in the framing buffer outright.
    pub fn finish(&mut self, out: &mut Vec<Vec<u8>>) {
        let remaining = std::mem::take(&mut self.buf);
        for nal in split_nal_units(&remaining) {
            self.push(nal, out);
        }
    }

    fn push(&mut self, nal: Vec<u8>, out: &mut Vec<Vec<u8>>) {
        let Some(&header) = nal.first() else { return };
        match header & 0x1F {
            7 => {
                if codec_string_from_sps(&nal).is_some() {
                    self.sps = Some(nal);
                } else {
                    self.warn_malformed("SPS", nal.len());
                    return;
                }
            }
            8 => {
                self.pps = Some(nal);
            }
            _ => {
                self.emit_or_hold(nal, out);
                return;
            }
        }
        if self.builder.is_some() {
            return;
        }
        let (Some(sps), Some(pps)) = (self.sps.as_deref(), self.pps.as_deref()) else { return };
        let Some(builder) = Fmp4Builder::from_parameter_sets(sps, pps) else {
            self.warn_malformed("SPS+PPS", sps.len() + pps.len());
            self.sps = None;
            self.pps = None;
            return;
        };
        let codec = builder.codec_string();
        let init = builder.init_segment();
        let mut frame = Vec::with_capacity(1 + 4 + codec.len() + init.len());
        frame.push(FRAME_INIT);
        frame.extend_from_slice(&(codec.len() as u32).to_be_bytes());
        frame.extend_from_slice(codec.as_bytes());
        frame.extend_from_slice(init);
        out.push(frame);
        self.builder = Some(builder);
        // A stream that only ever had pending P-slices must flush nothing
        // rather than lead with garbage the decoder cannot start from.
        self.evict_to_newest_keyframe();
        self.pending_bytes = 0;
        for slice in std::mem::take(&mut self.pending) {
            self.emit_or_hold(slice, out);
        }
    }

    fn emit_or_hold(&mut self, nal: Vec<u8>, out: &mut Vec<Vec<u8>>) {
        match self.builder.as_mut() {
            Some(b) => {
                let media = b.append_nal(&nal);
                let mut frame = Vec::with_capacity(1 + media.len());
                frame.push(FRAME_MEDIA);
                frame.extend_from_slice(&media);
                out.push(frame);
            }
            None => {
                self.pending_bytes += nal.len();
                self.pending.push_back(nal);
                if self.pending.len() > MAX_PENDING_SLICES || self.pending_bytes > MAX_PENDING_BYTES {
                    self.evict_to_newest_keyframe();
                }
            }
        }
    }

    /// Drops from the front of `pending` until it leads with an IDR (or is
    /// empty), so the flush after bootstrap never starts mid-GOP.
    fn evict_to_newest_keyframe(&mut self) {
        while let Some(front) = self.pending.front() {
            if is_idr(front) {
                break;
            }
            let dropped = self.pending.pop_front().expect("front just checked Some");
            self.pending_bytes -= dropped.len();
        }
    }

    fn warn_malformed(&mut self, what: &str, len: usize) {
        if !self.warned_malformed {
            self.warned_malformed = true;
            log::warn!("[device] ignoring malformed {what} ({len} bytes); waiting for a usable one");
        }
    }
}

// ---- ISO 14496-12 box builders ------------------------------------------------

/// `[u32 BE size][4-char type][payload]`.
fn box_(btype: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut b = Vec::with_capacity(8 + payload.len());
    b.extend_from_slice(&(8 + payload.len() as u32).to_be_bytes());
    b.extend_from_slice(btype);
    b.extend_from_slice(payload);
    b
}

/// Full box: `[u32 BE size][4-char type][u8 version][u24 flags][payload]`.
fn fullbox(btype: &[u8; 4], version: u8, flags: u32, payload: &[u8]) -> Vec<u8> {
    let mut p = Vec::with_capacity(4 + payload.len());
    p.push(version);
    p.extend_from_slice(&flags.to_be_bytes()[1..]); // u24 big-endian
    p.extend_from_slice(payload);
    box_(btype, &p)
}

/// `ftyp(major="iso5", minor=0x200, compat=["iso5","iso6","mp41"]) + moov(...)`.
fn build_init(sps: &[u8], pps: &[u8]) -> Option<Vec<u8>> {
    let mut ftyp_p = Vec::with_capacity(20);
    ftyp_p.extend_from_slice(b"iso5"); // major_brand
    ftyp_p.extend_from_slice(&0x200u32.to_be_bytes()); // minor_version
    ftyp_p.extend_from_slice(b"iso5"); // compatible_brands
    ftyp_p.extend_from_slice(b"iso6");
    ftyp_p.extend_from_slice(b"mp41");
    let ftyp = box_(b"ftyp", &ftyp_p);

    let moov = build_moov(sps, pps)?;

    let mut init = Vec::with_capacity(ftyp.len() + moov.len());
    init.extend_from_slice(&ftyp);
    init.extend_from_slice(&moov);
    Some(init)
}

fn build_moov(sps: &[u8], pps: &[u8]) -> Option<Vec<u8>> {
    // mvhd (version 0)
    let mut mvhd_p = Vec::with_capacity(100);
    mvhd_p.extend_from_slice(&0u32.to_be_bytes()); // creation_time
    mvhd_p.extend_from_slice(&0u32.to_be_bytes()); // modification_time
    mvhd_p.extend_from_slice(&1000u32.to_be_bytes()); // timescale (ms)
    mvhd_p.extend_from_slice(&0u32.to_be_bytes()); // duration
    mvhd_p.extend_from_slice(&0x00010000u32.to_be_bytes()); // rate 1.0
    mvhd_p.extend_from_slice(&0x0100u16.to_be_bytes()); // volume 1.0
    mvhd_p.extend_from_slice(&0u16.to_be_bytes()); // reserved
    mvhd_p.extend_from_slice(&[0u8; 8]); // reserved
    // matrix (identity): 1.0,0,0, 0,1.0,0, 0,0,32768.0
    mvhd_p.extend_from_slice(&0x00010000u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0x00010000u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0u32.to_be_bytes());
    mvhd_p.extend_from_slice(&0x40000000u32.to_be_bytes());
    mvhd_p.extend_from_slice(&[0u8; 24]); // pre_defined (6 * u32)
    mvhd_p.extend_from_slice(&2u32.to_be_bytes()); // next_track_ID
    let mvhd = fullbox(b"mvhd", 0, 0, &mvhd_p);

    // tkhd (version 0, flags = enabled | in_movie = 0x000003)
    let mut tkhd_p = Vec::with_capacity(84);
    tkhd_p.extend_from_slice(&0u32.to_be_bytes()); // creation_time
    tkhd_p.extend_from_slice(&0u32.to_be_bytes()); // modification_time
    tkhd_p.extend_from_slice(&1u32.to_be_bytes()); // track_ID = 1
    tkhd_p.extend_from_slice(&0u32.to_be_bytes()); // reserved
    tkhd_p.extend_from_slice(&0u32.to_be_bytes()); // duration
    tkhd_p.extend_from_slice(&[0u8; 8]); // reserved
    tkhd_p.extend_from_slice(&0u16.to_be_bytes()); // layer
    tkhd_p.extend_from_slice(&0u16.to_be_bytes()); // alternate_group
    tkhd_p.extend_from_slice(&0u16.to_be_bytes()); // volume (video = 0)
    tkhd_p.extend_from_slice(&0u16.to_be_bytes()); // reserved
    tkhd_p.extend_from_slice(&0x00010000u32.to_be_bytes()); // matrix
    tkhd_p.extend_from_slice(&0u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0x00010000u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0u32.to_be_bytes());
    tkhd_p.extend_from_slice(&0x40000000u32.to_be_bytes());
    // width/height fixed 16.16 = 1280.0. MSE reads real dims from the SPS in avcC.
    tkhd_p.extend_from_slice(&(1280u32 << 16).to_be_bytes());
    tkhd_p.extend_from_slice(&(1280u32 << 16).to_be_bytes());
    let tkhd = fullbox(b"tkhd", 0, 0x000003, &tkhd_p);

    // mdhd (version 0)
    let mut mdhd_p = Vec::with_capacity(24);
    mdhd_p.extend_from_slice(&0u32.to_be_bytes()); // creation_time
    mdhd_p.extend_from_slice(&0u32.to_be_bytes()); // modification_time
    mdhd_p.extend_from_slice(&1000u32.to_be_bytes()); // timescale (ms)
    mdhd_p.extend_from_slice(&0u32.to_be_bytes()); // duration
    mdhd_p.extend_from_slice(&0x55C4u16.to_be_bytes()); // language = 'und'
    mdhd_p.extend_from_slice(&0u16.to_be_bytes()); // pre_defined
    let mdhd = fullbox(b"mdhd", 0, 0, &mdhd_p);

    // hdlr (vide)
    let mut hdlr_p = Vec::new();
    hdlr_p.extend_from_slice(&0u32.to_be_bytes()); // pre_defined
    hdlr_p.extend_from_slice(b"vide"); // handler_type
    hdlr_p.extend_from_slice(&[0u8; 12]); // reserved
    hdlr_p.extend_from_slice(b"VideoHandler\0"); // name (null-terminated)
    let hdlr = fullbox(b"hdlr", 0, 0, &hdlr_p);

    // vmhd (flags = 1)
    let vmhd = fullbox(b"vmhd", 0, 1, &[0u8; 8]); // graphicsmode + opcolor

    // dinf > dref > url (self-contained)
    let url_box = fullbox(b"url ", 0, 1, &[]); // self_contained flag
    let mut dref_p = Vec::with_capacity(4 + url_box.len());
    dref_p.extend_from_slice(&1u32.to_be_bytes()); // entry_count
    dref_p.extend_from_slice(&url_box);
    let dref = fullbox(b"dref", 0, 0, &dref_p);
    let dinf = box_(b"dinf", &dref);

    // stsd > avc1 > avcC
    let avc1 = build_avc1(sps, pps)?;
    let mut stsd_p = Vec::with_capacity(4 + avc1.len());
    stsd_p.extend_from_slice(&1u32.to_be_bytes()); // entry_count
    stsd_p.extend_from_slice(&avc1);
    let stsd = fullbox(b"stsd", 0, 0, &stsd_p);

    // fMP4 moov sample tables are empty placeholders; real sample info lives in
    // each moof/traf/trun.
    let stts = fullbox(b"stts", 0, 0, &0u32.to_be_bytes()); // entry_count = 0
    let stsc = fullbox(b"stsc", 0, 0, &0u32.to_be_bytes()); // entry_count = 0
    let mut stsz_p = Vec::with_capacity(8);
    stsz_p.extend_from_slice(&0u32.to_be_bytes()); // sample_size = 0
    stsz_p.extend_from_slice(&0u32.to_be_bytes()); // sample_count = 0
    let stsz = fullbox(b"stsz", 0, 0, &stsz_p);
    let stco = fullbox(b"stco", 0, 0, &0u32.to_be_bytes()); // entry_count = 0

    let mut stbl_p = Vec::new();
    stbl_p.extend_from_slice(&stsd);
    stbl_p.extend_from_slice(&stts);
    stbl_p.extend_from_slice(&stsc);
    stbl_p.extend_from_slice(&stsz);
    stbl_p.extend_from_slice(&stco);
    let stbl = box_(b"stbl", &stbl_p);

    let mut minf_p = Vec::new();
    minf_p.extend_from_slice(&vmhd);
    minf_p.extend_from_slice(&dinf);
    minf_p.extend_from_slice(&stbl);
    let minf = box_(b"minf", &minf_p);

    let mut mdia_p = Vec::new();
    mdia_p.extend_from_slice(&mdhd);
    mdia_p.extend_from_slice(&hdlr);
    mdia_p.extend_from_slice(&minf);
    let mdia = box_(b"mdia", &mdia_p);

    let mut trak_p = Vec::new();
    trak_p.extend_from_slice(&tkhd);
    trak_p.extend_from_slice(&mdia);
    let trak = box_(b"trak", &trak_p);

    let mut moov_p = Vec::new();
    moov_p.extend_from_slice(&mvhd);
    moov_p.extend_from_slice(&trak);
    // mvex (Movie Extends Box) is REQUIRED by Chrome's fMP4 parser — without it
    // the moov declares a regular (non-fragmented) movie and the browser silently
    // rejects all moof+mdat media fragments. Contains a trex per track.
    moov_p.extend_from_slice(&build_mvex());
    Some(box_(b"moov", &moov_p))
}

/// `mvex` + one `trex` for track_ID=1. Chrome requires this to know the movie
/// is fragmented before accepting any moof+mdat data.
fn build_mvex() -> Vec<u8> {
    // trex: track_ID=1, all defaults set to 0 (trun provides per-sample values).
    let mut trex_p = Vec::with_capacity(20);
    trex_p.extend_from_slice(&1u32.to_be_bytes()); // track_ID
    trex_p.extend_from_slice(&1u32.to_be_bytes()); // default_sample_description_index
    trex_p.extend_from_slice(&0u32.to_be_bytes()); // default_sample_duration
    trex_p.extend_from_slice(&0u32.to_be_bytes()); // default_sample_size
    trex_p.extend_from_slice(&0u32.to_be_bytes()); // default_sample_flags
    let trex = fullbox(b"trex", 0, 0, &trex_p);
    box_(b"mvex", &trex)
}

/// `avc1` VisualSampleEntry containing an `avcC` (AVCDecoderConfigurationRecord).
fn build_avc1(sps: &[u8], pps: &[u8]) -> Option<Vec<u8>> {
    let mut p = Vec::with_capacity(78 + 42);
    // SampleEntry: reserved[6] + data_reference_index = 1
    p.extend_from_slice(&[0u8; 6]);
    p.extend_from_slice(&1u16.to_be_bytes());
    // VisualSampleEntry fields:
    p.extend_from_slice(&0u16.to_be_bytes()); // pre_defined
    p.extend_from_slice(&0u16.to_be_bytes()); // reserved
    p.extend_from_slice(&[0u8; 12]); // pre_defined[3]
    p.extend_from_slice(&1280u16.to_be_bytes()); // width
    p.extend_from_slice(&1280u16.to_be_bytes()); // height
    p.extend_from_slice(&0x00480000u32.to_be_bytes()); // horizresolution (72 dpi)
    p.extend_from_slice(&0x00480000u32.to_be_bytes()); // vertresolution (72 dpi)
    p.extend_from_slice(&0u32.to_be_bytes()); // reserved
    p.extend_from_slice(&1u16.to_be_bytes()); // frame_count
    p.extend_from_slice(&[0u8; 32]); // compressorname (empty)
    p.extend_from_slice(&0x0018u16.to_be_bytes()); // depth = 24
    p.extend_from_slice(&0xFFFFu16.to_be_bytes()); // pre_defined = -1
    // child box: avcC
    p.extend_from_slice(&build_avcc(sps, pps)?);
    Some(box_(b"avc1", &p))
}

/// `avcC` (AVCDecoderConfigurationRecord, ISO 14496-15). None when the SPS
/// cannot supply profile/compat/level, the PPS is empty, or a length overflows
/// the record's u16 fields.
fn build_avcc(sps: &[u8], pps: &[u8]) -> Option<Vec<u8>> {
    let [_, profile, compat, level, ..] = sps else { return None };
    if pps.is_empty() {
        return None;
    }
    let sps_len = u16::try_from(sps.len()).ok()?;
    let pps_len = u16::try_from(pps.len()).ok()?;
    let mut p = Vec::with_capacity(34);
    p.push(1u8); // configurationVersion
    p.push(*profile); // AVCProfileIndication = profile_idc
    p.push(*compat); // profile_compatibility
    p.push(*level); // AVCLevelIndication = level_idc
    p.push(0xFF); // reserved(6)=0x3F + lengthSizeMinusOne(2)=3 → 4-byte NAL length
    p.push(0xE1); // reserved(3)=0x7 + numOfSequenceParameterSets = 1
    p.extend_from_slice(&sps_len.to_be_bytes());
    p.extend_from_slice(sps); // SPS NAL (incl. 0x67 header byte)
    p.push(1u8); // numOfPictureParameterSets = 1
    p.extend_from_slice(&pps_len.to_be_bytes());
    p.extend_from_slice(pps); // PPS NAL (incl. 0x68 header byte)
    Some(box_(b"avcC", &p))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPS_HIGH_31: [u8; 8] = [0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40, 0x50];
    const PPS: [u8; 6] = [0x68, 0xce, 0x01, 0xa8, 0x35, 0xc8];
    const IDR: [u8; 5] = [0x65, 0x88, 0x84, 0x00, 0x33];

    fn init_codec(frame: &[u8]) -> String {
        let n = u32::from_be_bytes(frame[0..4].try_into().unwrap()) as usize;
        String::from_utf8(frame[4..4 + n].to_vec()).unwrap()
    }

    #[test]
    fn codec_string_from_sps_rejects_sps_shorter_than_four_bytes() {
        assert_eq!(codec_string_from_sps(&[]), None);
        assert_eq!(codec_string_from_sps(&[0x67]), None);
        assert_eq!(codec_string_from_sps(&[0x67, 0x64, 0x00]), None);
    }

    #[test]
    fn codec_string_from_sps_derives_profile_compat_level() {
        assert_eq!(codec_string_from_sps(&SPS_HIGH_31).as_deref(), Some("avc1.64001f"));
        assert_eq!(codec_string_from_sps(&[0x67, 0x42, 0xc0, 0x29]).as_deref(), Some("avc1.42c029"));
    }

    #[test]
    fn from_parameter_sets_refuses_short_sps_and_empty_pps() {
        assert!(Fmp4Builder::from_parameter_sets(&[0x67], &PPS).is_none());
        assert!(Fmp4Builder::from_parameter_sets(&[0x67, 0x64, 0x00], &PPS).is_none());
        assert!(Fmp4Builder::from_parameter_sets(&SPS_HIGH_31, &[]).is_none());
        let oversized = vec![0x67u8; u16::MAX as usize + 1];
        assert!(Fmp4Builder::from_parameter_sets(&oversized, &PPS).is_none());
    }

    #[test]
    fn from_parameter_sets_builds_init_for_valid_sets() {
        let b = Fmp4Builder::from_parameter_sets(&SPS_HIGH_31, &PPS).expect("valid SPS+PPS");
        assert_eq!(b.codec_string(), "avc1.64001f");
        assert_eq!(&b.init_segment()[4..8], b"ftyp");
    }

    #[test]
    fn drain_skips_empty_nal_between_adjacent_start_codes() {
        let mut buf = vec![0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x65, 0xAA, 0x00, 0x00, 0x01];
        let drained = drain_complete_nals(&mut buf);
        assert!(drained.iter().all(|n| !n.is_empty()), "got {drained:?}");
        assert_eq!(drained, vec![vec![0x65, 0xAA]]);
    }

    #[test]
    fn split_nal_units_skips_empty_nal_between_adjacent_start_codes() {
        let bytes = [0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x68, 0xDD];
        assert_eq!(split_nal_units(&bytes), vec![vec![0x68, 0xDD]]);
    }

    #[test]
    fn assembler_ignores_one_byte_sps_and_never_bootstraps() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(vec![0x67], &mut out);
        a.push(PPS.to_vec(), &mut out);
        a.push(IDR.to_vec(), &mut out);
        assert!(out.is_empty(), "no segment may be emitted from a malformed SPS");
        assert!(!a.is_bootstrapped());
    }

    #[test]
    fn assembler_ignores_three_byte_sps_and_never_bootstraps() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(vec![0x67, 0x64, 0x00], &mut out);
        a.push(PPS.to_vec(), &mut out);
        a.push(IDR.to_vec(), &mut out);
        assert!(out.is_empty());
        assert!(!a.is_bootstrapped());
    }

    #[test]
    fn assembler_tolerates_empty_nal() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(Vec::new(), &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn assembler_bootstraps_then_streams_media() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(SPS_HIGH_31.to_vec(), &mut out);
        a.push(PPS.to_vec(), &mut out);
        assert!(a.is_bootstrapped());
        a.push(IDR.to_vec(), &mut out);
        assert_eq!(out.len(), 2);
        match decode_frame(&out[0]) {
            Some(Frame::Init(payload)) => assert_eq!(init_codec(payload), "avc1.64001f"),
            other => panic!("expected init first, got {other:?}"),
        }
        assert!(matches!(decode_frame(&out[1]), Some(Frame::Media(m)) if &m[4..8] == b"moof"));
        // A repeated SPS/PPS mid-stream must not re-emit the init segment.
        a.push(SPS_HIGH_31.to_vec(), &mut out);
        a.push(PPS.to_vec(), &mut out);
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn assembler_recovers_when_a_valid_sps_follows_a_malformed_one() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(vec![0x67, 0x64], &mut out);
        a.push(PPS.to_vec(), &mut out);
        a.push(SPS_HIGH_31.to_vec(), &mut out);
        assert!(a.is_bootstrapped());
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
    }

    #[test]
    fn assembler_flushes_pending_slices_after_bootstrap_in_order() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(IDR.to_vec(), &mut out);
        a.push(vec![0x61, 0x01], &mut out);
        assert!(out.is_empty());
        a.push(SPS_HIGH_31.to_vec(), &mut out);
        a.push(PPS.to_vec(), &mut out);
        assert_eq!(out.len(), 3);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
        assert!(matches!(decode_frame(&out[1]), Some(Frame::Media(_))));
        assert!(matches!(decode_frame(&out[2]), Some(Frame::Media(_))));
    }

    const P_SLICE: [u8; 2] = [0x61, 0x01];

    #[test]
    fn assembler_bounds_pending_slices_before_bootstrap() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        for _ in 0..(MAX_PENDING_SLICES + 50) {
            a.push(IDR.to_vec(), &mut out);
        }
        a.push(SPS_HIGH_31.to_vec(), &mut out);
        a.push(PPS.to_vec(), &mut out);
        let media = out.iter().filter(|f| matches!(decode_frame(f), Some(Frame::Media(_)))).count();
        // Every pushed slice is itself an IDR, so eviction never finds a
        // non-keyframe front to drop: the cap only bites a non-keyframe head.
        assert_eq!(media, MAX_PENDING_SLICES + 50);
    }

    #[test]
    fn assembler_cap_keeps_the_newest_keyframe_led_run() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        let idr_at = 200;
        for i in 0..(MAX_PENDING_SLICES + 1) {
            if i == idr_at {
                a.push(IDR.to_vec(), &mut out);
            } else {
                a.push(P_SLICE.to_vec(), &mut out);
            }
        }
        assert_eq!(a.pending.len(), MAX_PENDING_SLICES + 1 - idr_at);
        assert_eq!(a.pending.front(), Some(&IDR.to_vec()));
    }

    #[test]
    fn assembler_cap_clears_a_queue_with_no_keyframe() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        for _ in 0..(MAX_PENDING_SLICES + 1) {
            a.push(P_SLICE.to_vec(), &mut out);
        }
        assert!(a.pending.is_empty());
        assert_eq!(a.pending_bytes, 0);
    }

    #[test]
    fn assembler_byte_budget_evicts_before_the_count_cap() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        let big_slice = vec![0x61u8; 3 * 1024 * 1024];
        for _ in 0..3 {
            a.push(big_slice.clone(), &mut out);
        }
        assert!(a.pending.is_empty(), "byte budget must evict before the 256-slice count cap is ever reached");
    }

    #[test]
    fn assembler_flush_after_bootstrap_skips_leading_non_keyframes() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push(P_SLICE.to_vec(), &mut out);
        a.push(P_SLICE.to_vec(), &mut out);
        a.push(IDR.to_vec(), &mut out);
        a.push(P_SLICE.to_vec(), &mut out);
        assert!(out.is_empty());
        a.push(SPS_HIGH_31.to_vec(), &mut out);
        a.push(PPS.to_vec(), &mut out);
        assert_eq!(out.len(), 3);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
        match decode_frame(&out[1]) {
            Some(Frame::Media(m)) => assert_eq!(&m[108..], IDR.as_slice(), "flush must lead with the IDR, not a stale P-slice"),
            other => panic!("expected media, got {other:?}"),
        }
        match decode_frame(&out[2]) {
            Some(Frame::Media(m)) => assert_eq!(&m[108..], P_SLICE.as_slice()),
            other => panic!("expected media, got {other:?}"),
        }
    }

    /// Annex-B byte stream (4-byte start codes) for the given NALs, the way
    /// bytes actually arrive off the scrcpy socket.
    fn nal_stream(nals: &[&[u8]]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for nal in nals {
            bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
            bytes.extend_from_slice(nal);
        }
        bytes
    }

    #[test]
    fn assembler_emits_init_exactly_once_and_before_first_media() {
        let bytes = nal_stream(&[
            &SPS_HIGH_31, &PPS, &IDR, &P_SLICE, &SPS_HIGH_31, &PPS, &P_SLICE,
        ]);
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&bytes, &mut out);
        a.finish(&mut out);

        let init_count = out.iter().filter(|f| matches!(decode_frame(f), Some(Frame::Init(_)))).count();
        assert_eq!(init_count, 1, "a repeated SPS+PPS mid-stream must not re-emit the init segment");
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))), "the init segment must lead the output");
    }

    #[test]
    fn assembler_reassembles_a_nal_split_across_two_reads() {
        let bytes = nal_stream(&[&SPS_HIGH_31, &PPS, &IDR, &P_SLICE]);
        // Land inside the IDR NAL's payload bytes, not on a start-code boundary.
        let idr_payload_start = bytes.len() - PPS.len() - P_SLICE.len() - 4;
        let split_at = idr_payload_start + 2;

        let mut whole = StreamAssembler::default();
        let mut out_whole = Vec::new();
        whole.push_bytes(&bytes, &mut out_whole);
        whole.finish(&mut out_whole);

        let mut split = StreamAssembler::default();
        let mut out_split = Vec::new();
        split.push_bytes(&bytes[..split_at], &mut out_split);
        split.push_bytes(&bytes[split_at..], &mut out_split);
        split.finish(&mut out_split);

        assert!(!out_whole.is_empty());
        assert_eq!(out_whole, out_split, "a NAL split across two reads must reassemble identically");
    }

    #[test]
    fn assembler_buffers_pre_bootstrap_slices_and_flushes_in_order_from_bytes() {
        let bytes = nal_stream(&[&IDR, &P_SLICE, &SPS_HIGH_31, &PPS]);
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&bytes, &mut out);
        a.finish(&mut out);

        assert_eq!(out.len(), 3);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
        match decode_frame(&out[1]) {
            Some(Frame::Media(m)) => assert_eq!(&m[108..], IDR.as_slice(), "the first media segment must be the IDR"),
            other => panic!("expected media, got {other:?}"),
        }
        match decode_frame(&out[2]) {
            Some(Frame::Media(m)) => assert_eq!(&m[108..], P_SLICE.as_slice(), "media segments must stay in arrival order"),
            other => panic!("expected media, got {other:?}"),
        }
    }

    #[test]
    fn frame_discriminator_round_trips_init_and_media() {
        let bytes = nal_stream(&[&SPS_HIGH_31, &PPS, &IDR]);
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&bytes, &mut out);
        a.finish(&mut out);

        assert_eq!(out.len(), 2);
        match decode_frame(&out[0]) {
            Some(Frame::Init(payload)) => {
                let len = u32::from_be_bytes(payload[0..4].try_into().unwrap()) as usize;
                assert_eq!(&payload[4..4 + len], b"avc1.64001f");
            }
            other => panic!("expected init frame, got {other:?}"),
        }
        match decode_frame(&out[1]) {
            Some(Frame::Media(payload)) => assert_eq!(&payload[4..8], b"moof"),
            other => panic!("expected media frame, got {other:?}"),
        }
    }

    #[test]
    fn decode_frame_rejects_empty_and_unknown_discriminators() {
        assert_eq!(decode_frame(&[]), None);
        assert_eq!(decode_frame(&[2, 0xAA]), None);
    }

    fn annexb_fixture() -> Vec<u8> {
        let mut v = Vec::new();
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x01, 0x65, 0xAA, 0xBB, 0xCC]);
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x01, 0x68, 0xDD, 0xEE]);
        v
    }

    #[test]
    fn split_nal_units_finds_two_units_with_4byte_start_codes() {
        let nals = split_nal_units(&annexb_fixture());
        assert_eq!(nals.len(), 2);
        assert_eq!(nals[0], vec![0x65, 0xAA, 0xBB, 0xCC]);
        assert_eq!(nals[1], vec![0x68, 0xDD, 0xEE]);
    }

    #[test]
    fn split_nal_units_handles_3byte_start_code() {
        let bytes = [0x00, 0x00, 0x01, 0x67, 0x42, 0x00];
        let nals = split_nal_units(&bytes);
        assert_eq!(nals.len(), 1);
        assert_eq!(nals[0], vec![0x67, 0x42, 0x00]);
    }

    #[test]
    fn split_nal_units_handles_trailing_partial_start_code() {
        let bytes = [0x00, 0x00, 0x00, 0x01, 0x65, 0xAA, 0x00, 0x00, 0x01];
        let nals = split_nal_units(&bytes);
        assert_eq!(nals.len(), 1);
        assert_eq!(nals[0], vec![0x65, 0xAA]);
    }

    #[test]
    fn split_nal_units_empty_input_yields_empty_output() {
        assert!(split_nal_units(&[]).is_empty());
    }

    #[test]
    fn drain_returns_complete_nals_and_keeps_tail() {
        // Two complete NALs + a partial third (no terminating start code yet).
        let mut buf = annexb_fixture();
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x01, 0x61, 0x77, 0x88]);
        let drained = drain_complete_nals(&mut buf);
        assert_eq!(drained.len(), 2);
        assert_eq!(drained[0], vec![0x65, 0xAA, 0xBB, 0xCC]);
        assert_eq!(drained[1], vec![0x68, 0xDD, 0xEE]);
        // Tail retained: the partial NAL *with* its start code.
        assert_eq!(buf, vec![0x00, 0x00, 0x00, 0x01, 0x61, 0x77, 0x88]);
    }

    #[test]
    fn drain_nothing_with_only_one_start_code() {
        let mut buf = vec![0x00, 0x00, 0x00, 0x01, 0x65, 0xAA];
        assert!(drain_complete_nals(&mut buf).is_empty());
        assert_eq!(buf, vec![0x00, 0x00, 0x00, 0x01, 0x65, 0xAA]);
    }

    /// Regression guard for the black-video bug: scrcpy `raw_stream=true`
    /// strips per-frame PTS, so the muxer must synthesize a timeline itself.
    /// If every media fragment has `sample_duration=0` and no `tfdt`, the MSE
    /// `buffered` range collapses to zero length and the `<video>` paints
    /// nothing (pure `bg-black`). This test pins the fixed moof layout:
    ///   moof[box(8) + mfhd(16) + traf(box(8) + tfhd(16) + tfdt(20) + trun(28))]
    ///     + mdat header(8) + mdat body.
    #[test]
    fn append_nal_advances_tfdt_and_emits_nonzero_duration() {
        let mut b = Fmp4Builder::from_parameter_sets(&SPS_HIGH_31, &PPS).unwrap();
        let nal = vec![0x65u8, 0x88, 0x84, 0x00, 0x33]; // an IDR-ish slice NAL
        let f1 = b.append_nal(&nal);
        let f2 = b.append_nal(&nal);

        // A `moof` must open the fragment.
        assert_eq!(&f1[4..8], b"moof");
        // A `tfdt` subbox (v1, payload u64) lives at fragment offset 48..68;
        // its baseMediaDecodeTime u64 is at 60..68.
        assert_eq!(&f1[52..56], b"tfdt", "no tfdt box — MSE has no fragment time base");
        let tfdt = |f: &[u8]| u64::from_be_bytes(f[60..68].try_into().unwrap());
        assert_eq!(tfdt(&f1), 0, "first fragment must start at decode time 0");
        assert_eq!(tfdt(&f2), 33, "fragment decode time must advance by the nominal duration");
        // `trun` sample_duration (u32) at offset 88..92 must be non-zero or the
        // MSE buffered range collapses to zero length → black video.
        assert_eq!(&f1[72..76], b"trun");
        let duration = u32::from_be_bytes(f1[88..92].try_into().unwrap());
        assert!(duration > 0, "sample_duration=0 produces a zero-length buffered range");
        // data_offset (u32 at 84..88) must point at the mdat body: moof(96)+mdat header(8)=104.
        let data_offset = u32::from_be_bytes(f1[84..88].try_into().unwrap());
        assert_eq!(data_offset, 104, "data_offset must point past the (now tfdt-bearing) moof");
    }
}