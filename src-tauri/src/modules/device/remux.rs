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

/// fMP4 (fragmented MP4 / CMAF) muxer for a single H.264 elementary stream.
/// One `moof`+`mdat` fragment per access unit. The init segment (`ftyp`+`moov`
/// with the `avcC` decoder config record) is built once from the SPS+PPS the
/// capture's config packet carries.
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
    timeline: FrameTimeline,
}

/// `avc1.PPCCLL` from an SPS NAL (header byte + profile_idc +
/// constraint flags + level_idc). None when the NAL is too short to carry them.
pub fn codec_string_from_sps(sps: &[u8]) -> Option<String> {
    match sps {
        [_, profile, compat, level, ..] => Some(format!("avc1.{profile:02x}{compat:02x}{level:02x}")),
        _ => None,
    }
}

/// `sample_flags` for a random access point: `sample_depends_on = 2`
/// (references nothing) and `sample_is_non_sync_sample = 0`.
const SAMPLE_FLAGS_KEY_FRAME: u32 = 0x0200_0000;

/// `sample_flags` for a delta frame: `sample_depends_on = 1` plus
/// `sample_is_non_sync_sample = 1`, so a seek never lands on it.
const SAMPLE_FLAGS_DELTA: u32 = 0x0101_0000;

impl Fmp4Builder {
    /// `sps`/`pps` are raw NAL payloads without the Annex-B start code but with
    /// the 1-byte NAL header. None for parameter sets that cannot fill an avcC.
    pub fn from_parameter_sets(sps: &[u8], pps: &[u8]) -> Option<Self> {
        let codec_string = codec_string_from_sps(sps)?;
        let init_segment = build_init(sps, pps)?;
        Some(Self {
            codec_string,
            init_segment,
            sequence_number: 0,
            timeline: FrameTimeline::default(),
        })
    }

    pub fn codec_string(&self) -> &str { &self.codec_string }

    pub fn init_segment(&self) -> &[u8] { &self.init_segment }

    /// Wrap one complete access unit (its NALs, no start codes) as a single
    /// fMP4 sample and return the wire frame `[FRAME_MEDIA][moof+mdat]`. The
    /// `mdat` body concatenates `[u32 BE length][nal]` per NAL (AVC length
    /// prefix = 4 bytes, matching the `lengthSizeMinusOne=3` in `avcC`).
    /// `mfhd` carries a per-session incrementing `sequence_number`; `tfdt`
    /// carries the decode time `FrameTimeline` derives from `pts_us`.
    pub fn append_access_unit(
        &mut self,
        nals: &[impl AsRef<[u8]>],
        key_frame: bool,
        pts_us: u64,
    ) -> Vec<u8> {
        self.sequence_number = self.sequence_number.wrapping_add(1);
        let seq = self.sequence_number;
        let (decode_time, duration) = self.timeline.next(pts_us);

        let sample_size: u32 = nals
            .iter()
            .map(|nal| 4 + nal.as_ref().len() as u32)
            .sum();

        let mfhd = fullbox(b"mfhd", 0, 0, &seq.to_be_bytes());

        // default-base-is-moof (0x020000): trun data_offset is measured from the
        // first byte of the enclosing `moof` box, so no base_data_offset is needed.
        let mut tfhd_p = Vec::with_capacity(4);
        tfhd_p.extend_from_slice(&1u32.to_be_bytes()); // track_ID = 1
        let tfhd = fullbox(b"tfhd", 0, 0x020000, &tfhd_p);

        // tfdt (version 1, u64 baseMediaDecodeTime): the decode-time anchor MSE
        // needs to place this fragment on the timeline. Without it (and with a
        // zero duration) the <video> never paints, the original black-screen bug.
        let tfdt = fullbox(b"tfdt", 1, 0, &decode_time.to_be_bytes());

        // trun flags: data-offset-present (0x000001) | sample-duration-present
        // (0x000100) | sample-size-present (0x000200) | sample-flags-present
        // (0x000400) = 0x000701.
        let mut trun_p = Vec::with_capacity(20);
        trun_p.extend_from_slice(&1u32.to_be_bytes()); // sample_count
        trun_p.extend_from_slice(&0u32.to_be_bytes()); // data_offset, patched below
        trun_p.extend_from_slice(&duration.to_be_bytes());
        trun_p.extend_from_slice(&sample_size.to_be_bytes());
        let sample_flags = if key_frame { SAMPLE_FLAGS_KEY_FRAME } else { SAMPLE_FLAGS_DELTA };
        trun_p.extend_from_slice(&sample_flags.to_be_bytes());
        let mut trun = fullbox(b"trun", 0, 0x000701, &trun_p);

        // data_offset points at the mdat body, measured from the start of the
        // moof. Derived from the boxes just built so a layout change cannot
        // leave it stale.
        let traf_len = 8 + tfhd.len() + tfdt.len() + trun.len();
        let moof_len = 8 + mfhd.len() + traf_len;
        let data_offset = (moof_len + 8) as u32;
        let at = trun.len() - trun_p.len() + 4; // past the trun header and sample_count
        trun[at..at + 4].copy_from_slice(&data_offset.to_be_bytes());

        let mut traf_p = Vec::with_capacity(traf_len - 8);
        traf_p.extend_from_slice(&tfhd);
        traf_p.extend_from_slice(&tfdt);
        traf_p.extend_from_slice(&trun);
        let traf = box_(b"traf", &traf_p);

        let mut moof_p = Vec::with_capacity(moof_len - 8);
        moof_p.extend_from_slice(&mfhd);
        moof_p.extend_from_slice(&traf);
        let moof = box_(b"moof", &moof_p);

        // The discriminator is reserved up front so the finished frame is never
        // copied a second time just to prefix one byte.
        let mut frame = Vec::with_capacity(1 + moof.len() + 8 + sample_size as usize);
        frame.push(FRAME_MEDIA);
        frame.extend_from_slice(&moof);
        frame.extend_from_slice(&(8 + sample_size).to_be_bytes());
        frame.extend_from_slice(b"mdat");
        for nal in nals {
            let nal = nal.as_ref();
            frame.extend_from_slice(&(nal.len() as u32).to_be_bytes());
            frame.extend_from_slice(nal);
        }
        frame
    }
}

use std::collections::VecDeque;

use super::timeline::FrameTimeline;

/// Access units that arrive before SPS+PPS are held for the post-bootstrap
/// flush; a stream that never produces a usable SPS must not grow that queue
/// forever.
pub const MAX_PENDING_SLICES: usize = 256;

/// Byte-size counterpart to `MAX_PENDING_SLICES`: a handful of high-resolution
/// frames can blow past a lightweight memory budget well before the count cap.
pub const MAX_PENDING_BYTES: usize = 8 * 1024 * 1024;

/// Every packet the server writes with `send_frame_meta=true` is prefixed by
/// `[u64 BE pts_and_flags][u32 BE payload size]`.
const PACKET_HEADER_BYTES: usize = 12;

/// Session-meta packet: the 12-byte header stands alone, with no payload.
pub const PACKET_FLAG_SESSION: u64 = 1 << 63;

/// The payload is the codec config (Annex-B SPS+PPS), not a frame.
pub const PACKET_FLAG_CONFIG: u64 = 1 << 62;

/// The payload is a random access point.
pub const PACKET_FLAG_KEY_FRAME: u64 = 1 << 61;

/// The low 61 bits of `pts_and_flags` are the capture PTS in microseconds.
pub const PACKET_PTS_MASK: u64 = (1 << 61) - 1;

/// A single access unit far larger than any 1920-wide keyframe: a declared
/// size above this means the stream is desynchronized, not that a huge frame
/// arrived, so buffering it would only burn memory on garbage.
pub const MAX_PACKET_BYTES: usize = 16 * 1024 * 1024;

/// NAL type (low 5 bits of the header byte) 5 = IDR (coded slice of an IDR
/// picture), the only slice type a decoder can start rendering from cleanly.
fn is_idr(nal: &[u8]) -> bool {
    nal.first().is_some_and(|b| b & 0x1F == 5)
}

/// NAL type 9 = access unit delimiter: a framing hint the encoder emits that
/// carries no picture data, so it is dropped rather than muxed.
const NAL_TYPE_AUD: u8 = 9;

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
    /// `moof+mdat` for one access unit.
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

/// One access unit waiting for the SPS+PPS that lets it be muxed.
struct PendingUnit {
    nals: Vec<Vec<u8>>,
    key_frame: bool,
    pts_us: u64,
    bytes: usize,
}

/// Turns the packet stream of one capture into fMP4 segments: emits the init
/// segment once from the config packet's SPS+PPS, then one media fragment per
/// access unit. Malformed parameter sets are skipped, so the stream is simply
/// not bootstrapped yet rather than panicking or emitting a broken avcC.
#[derive(Default)]
pub struct StreamAssembler {
    /// Packet bytes accumulated across reads, not yet a complete packet.
    buf: Vec<u8>,
    corrupt: bool,
    builder: Option<Fmp4Builder>,
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
    pending: VecDeque<PendingUnit>,
    pending_bytes: usize,
    warned_malformed: bool,
}

impl StreamAssembler {
    pub fn is_bootstrapped(&self) -> bool {
        self.builder.is_some()
    }

    /// True once a packet header declared a size no capture can produce. The
    /// assembler emits nothing further; the read loop stops reading.
    pub fn is_corrupt(&self) -> bool {
        self.corrupt
    }

    /// Append newly read bytes and process every packet that is now complete.
    /// A packet whose header or payload is split across reads waits in the
    /// buffer for the next call.
    pub fn push_bytes(&mut self, bytes: &[u8], out: &mut Vec<Vec<u8>>) {
        if self.corrupt {
            return;
        }
        self.buf.extend_from_slice(bytes);
        // Taken out of `self` so each packet can be handed to `&mut self`
        // without copying its payload first.
        let buf = std::mem::take(&mut self.buf);
        let mut consumed = 0usize;
        while let Some(header) = buf.get(consumed..consumed + PACKET_HEADER_BYTES) {
            let pts_and_flags = u64::from_be_bytes(header[0..8].try_into().expect("8 bytes"));
            let size = u32::from_be_bytes(header[8..12].try_into().expect("4 bytes")) as usize;
            if pts_and_flags & PACKET_FLAG_SESSION != 0 {
                consumed += PACKET_HEADER_BYTES;
                continue;
            }
            if size > MAX_PACKET_BYTES {
                log::warn!("[device] video stream desynchronized: packet declares {size} bytes");
                self.enter_corrupt_state();
                return;
            }
            let body = consumed + PACKET_HEADER_BYTES;
            let Some(payload) = buf.get(body..body + size) else { break };
            self.handle_packet(pts_and_flags, payload, out);
            consumed = body + size;
        }
        self.buf = buf;
        self.buf.drain(..consumed);
    }

    /// End of stream. Explicit packet sizes mean a trailing partial packet is
    /// unusable rather than a frame that only needs flushing, so this releases
    /// the buffer instead of emitting anything.
    pub fn finish(&mut self, _out: &mut Vec<Vec<u8>>) {
        self.buf = Vec::new();
    }

    fn enter_corrupt_state(&mut self) {
        self.corrupt = true;
        self.buf = Vec::new();
        self.pending = VecDeque::new();
        self.pending_bytes = 0;
    }

    fn handle_packet(&mut self, pts_and_flags: u64, payload: &[u8], out: &mut Vec<Vec<u8>>) {
        if pts_and_flags & PACKET_FLAG_CONFIG != 0 {
            self.handle_config(payload, out);
            return;
        }
        let nals: Vec<Vec<u8>> = split_nal_units(payload)
            .into_iter()
            .filter(|nal| !nal.is_empty() && nal[0] & 0x1F != NAL_TYPE_AUD)
            .collect();
        if nals.is_empty() {
            return;
        }
        let bytes = nals.iter().map(Vec::len).sum();
        // The flag is authoritative; the IDR scan only covers a capture that
        // did not set it, since eviction must never keep a headless GOP.
        let key_frame = pts_and_flags & PACKET_FLAG_KEY_FRAME != 0
            || nals.iter().any(|nal| is_idr(nal));
        let unit = PendingUnit {
            nals,
            key_frame,
            pts_us: pts_and_flags & PACKET_PTS_MASK,
            bytes,
        };
        self.emit_or_hold(unit, out);
    }

    /// The init segment is emitted exactly once: MSE cannot swap an initialized
    /// SourceBuffer's decoder config, so a later config packet (a rotation, or
    /// scrcpy's `downsize_on_error` re-encode) is ignored until the session restarts.
    fn handle_config(&mut self, payload: &[u8], out: &mut Vec<Vec<u8>>) {
        if self.builder.is_some() {
            return;
        }
        for nal in split_nal_units(payload) {
            match nal.first().map(|header| header & 0x1F) {
                Some(7) => {
                    if codec_string_from_sps(&nal).is_some() {
                        self.sps = Some(nal);
                    } else {
                        self.warn_malformed("SPS", nal.len());
                    }
                }
                Some(8) => self.pps = Some(nal),
                _ => {}
            }
        }
        self.bootstrap(out);
    }

    fn bootstrap(&mut self, out: &mut Vec<Vec<u8>>) {
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
        // A stream that only ever had pending delta frames must flush nothing
        // rather than lead with garbage the decoder cannot start from.
        self.evict_to_newest_keyframe();
        self.pending_bytes = 0;
        for unit in std::mem::take(&mut self.pending) {
            self.emit_or_hold(unit, out);
        }
    }

    fn emit_or_hold(&mut self, unit: PendingUnit, out: &mut Vec<Vec<u8>>) {
        match self.builder.as_mut() {
            Some(b) => out.push(b.append_access_unit(&unit.nals, unit.key_frame, unit.pts_us)),
            None => {
                self.pending_bytes += unit.bytes;
                self.pending.push_back(unit);
                if self.pending.len() > MAX_PENDING_SLICES || self.pending_bytes > MAX_PENDING_BYTES {
                    self.evict_to_newest_keyframe();
                }
            }
        }
    }

    /// Drops from the front of `pending` until it leads with a key frame (or is
    /// empty), so the flush after bootstrap never starts mid-GOP.
    fn evict_to_newest_keyframe(&mut self) {
        while let Some(front) = self.pending.front() {
            if front.key_frame {
                break;
            }
            let dropped = self.pending.pop_front().expect("front just checked Some");
            self.pending_bytes -= dropped.bytes;
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
    mvhd_p.extend_from_slice(&1_000_000u32.to_be_bytes()); // timescale (capture PTS microseconds)
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
    mdhd_p.extend_from_slice(&1_000_000u32.to_be_bytes()); // timescale (capture PTS microseconds)
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
    // mvex (Movie Extends Box) is REQUIRED by Chrome's fMP4 parser, without it
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
    const P_SLICE: [u8; 2] = [0x61, 0x01];

    /// Annex-B byte stream (4-byte start codes) for the given NALs, the way a
    /// packet payload actually arrives off the scrcpy socket.
    fn nal_stream(nals: &[&[u8]]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for nal in nals {
            bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x01]);
            bytes.extend_from_slice(nal);
        }
        bytes
    }

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
    fn split_nal_units_skips_empty_nal_between_adjacent_start_codes() {
        let bytes = [0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x68, 0xDD];
        assert_eq!(split_nal_units(&bytes), vec![vec![0x68, 0xDD]]);
    }

    #[test]
    fn assembler_ignores_one_byte_sps_and_never_bootstraps() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &nal_stream(&[&[0x67], &PPS])), &mut out);
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        assert!(out.is_empty(), "no segment may be emitted from a malformed SPS");
        assert!(!a.is_bootstrapped());
    }

    #[test]
    fn assembler_ignores_three_byte_sps_and_never_bootstraps() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &nal_stream(&[&[0x67, 0x64, 0x00], &PPS])), &mut out);
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        assert!(out.is_empty());
        assert!(!a.is_bootstrapped());
    }

    #[test]
    fn assembler_tolerates_an_empty_payload() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &[]), &mut out);
        a.push_bytes(&packet(KEY, 0, &[]), &mut out);
        a.push_bytes(&packet(0, 0, &[0x00, 0x00, 0x00, 0x01]), &mut out);
        assert!(out.is_empty());
        assert!(!a.is_corrupt());
    }

    #[test]
    fn assembler_bootstraps_then_streams_media() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        assert!(a.is_bootstrapped());
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        assert_eq!(out.len(), 2);
        match decode_frame(&out[0]) {
            Some(Frame::Init(payload)) => assert_eq!(init_codec(payload), "avc1.64001f"),
            other => panic!("expected init first, got {other:?}"),
        }
        assert_eq!(&media_payload(&out[1])[4..8], b"moof");
    }

    #[test]
    fn assembler_recovers_when_a_valid_sps_follows_a_malformed_one() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &nal_stream(&[&[0x67, 0x64], &PPS])), &mut out);
        assert!(!a.is_bootstrapped());
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        assert!(a.is_bootstrapped());
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
    }

    #[test]
    fn assembler_flushes_pending_units_after_bootstrap_in_order() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        a.push_bytes(&packet(0, 33_333, &nal_stream(&[&P_SLICE])), &mut out);
        assert!(out.is_empty());
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        assert_eq!(out.len(), 3);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
        assert_eq!(mdat_nals(media_payload(&out[1]))[0], IDR);
        assert_eq!(mdat_nals(media_payload(&out[2]))[0], P_SLICE);
    }

    #[test]
    fn assembler_bounds_pending_units_before_bootstrap() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        for _ in 0..(MAX_PENDING_SLICES + 50) {
            a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        }
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        let media = out.iter().filter(|f| matches!(decode_frame(f), Some(Frame::Media(_)))).count();
        // Every held unit is itself a key frame, so eviction never finds a
        // delta front to drop: the cap only bites a non-keyframe head.
        assert_eq!(media, MAX_PENDING_SLICES + 50);
    }

    #[test]
    fn assembler_cap_keeps_the_newest_keyframe_led_run() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        let key_at = 200;
        for i in 0..(MAX_PENDING_SLICES + 1) {
            let (flags, nal): (u64, &[u8]) = if i == key_at { (KEY, &IDR) } else { (0, &P_SLICE) };
            a.push_bytes(&packet(flags, i as u64 * 33_333, &nal_stream(&[nal])), &mut out);
        }
        assert_eq!(a.pending.len(), MAX_PENDING_SLICES + 1 - key_at);
        let front = a.pending.front().expect("queue must keep the keyframe-led run");
        assert!(front.key_frame);
        assert_eq!(front.nals, vec![IDR.to_vec()]);
    }

    #[test]
    fn assembler_cap_clears_a_queue_with_no_keyframe() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        for _ in 0..(MAX_PENDING_SLICES + 1) {
            a.push_bytes(&packet(0, 0, &nal_stream(&[&P_SLICE])), &mut out);
        }
        assert!(a.pending.is_empty());
        assert_eq!(a.pending_bytes, 0);
    }

    #[test]
    fn assembler_byte_budget_evicts_before_the_count_cap() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        let big = vec![0x61u8; 3 * 1024 * 1024];
        for _ in 0..3 {
            a.push_bytes(&packet(0, 0, &nal_stream(&[&big])), &mut out);
        }
        assert!(a.pending.is_empty(), "byte budget must evict before the 256-unit count cap is ever reached");
    }

    #[test]
    fn assembler_flush_after_bootstrap_skips_leading_non_keyframes() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(0, 0, &nal_stream(&[&P_SLICE])), &mut out);
        a.push_bytes(&packet(0, 33_333, &nal_stream(&[&P_SLICE])), &mut out);
        a.push_bytes(&packet(KEY, 66_666, &nal_stream(&[&IDR])), &mut out);
        a.push_bytes(&packet(0, 99_999, &nal_stream(&[&P_SLICE])), &mut out);
        assert!(out.is_empty());
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        assert_eq!(out.len(), 3);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
        assert_eq!(
            mdat_nals(media_payload(&out[1]))[0],
            IDR,
            "flush must lead with the key frame, not a stale delta frame"
        );
        assert_eq!(mdat_nals(media_payload(&out[2]))[0], P_SLICE);
    }

    /// A key frame whose packet lost the flag is still a random access point,
    /// so eviction must not throw the GOP away.
    #[test]
    fn assembler_falls_back_to_an_idr_scan_when_the_key_frame_flag_is_absent() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(0, 0, &nal_stream(&[&P_SLICE])), &mut out);
        a.push_bytes(&packet(0, 33_333, &nal_stream(&[&IDR])), &mut out);
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(mdat_nals(media_payload(&out[1]))[0], IDR);
        assert_eq!(trun_of(media_payload(&out[1])).3, 0x0200_0000);
    }

    #[test]
    fn frame_discriminator_round_trips_init_and_media() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        a.finish(&mut out);

        assert_eq!(out.len(), 2);
        // Pin the literal wire values, not just decode_frame's interpretation
        // of them: swapping FRAME_INIT/FRAME_MEDIA would still round-trip
        // through decode_frame but would desync from the frontend's
        // `kind === 0` check.
        assert_eq!(out[0][0], 0, "init frame's leading byte must be FRAME_INIT (0)");
        assert_eq!(out[1][0], 1, "media frame's leading byte must be FRAME_MEDIA (1)");
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

    // ---- scrcpy frame-metadata framing -------------------------------------

    /// Wire flag bits, spelled out rather than reused from the implementation:
    /// a swapped constant would still round-trip through the parser but would
    /// desync from the server.
    const CONFIG: u64 = 1 << 62;
    const KEY: u64 = 1 << 61;
    const SESSION: u64 = 1 << 63;
    const AUD: [u8; 2] = [0x09, 0xF0];

    /// One packet as the server writes it with `send_frame_meta=true`:
    /// `[u64 BE pts|flags][u32 BE payload size][payload]`.
    fn packet(flags: u64, pts_us: u64, payload: &[u8]) -> Vec<u8> {
        let mut v = Vec::with_capacity(PACKET_HEADER_BYTES + payload.len());
        v.extend_from_slice(&(flags | pts_us).to_be_bytes());
        v.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        v.extend_from_slice(payload);
        v
    }

    fn config_payload() -> Vec<u8> {
        nal_stream(&[&SPS_HIGH_31, &PPS])
    }

    fn media_payload(frame: &[u8]) -> &[u8] {
        match decode_frame(frame) {
            Some(Frame::Media(p)) => p,
            other => panic!("expected a media frame, got {other:?}"),
        }
    }

    fn find_box<'a>(region: &'a [u8], btype: &[u8; 4]) -> &'a [u8] {
        let at = region.windows(4).position(|w| w == btype).expect("box must be present");
        let start = at - 4;
        let size = u32::from_be_bytes(region[start..start + 4].try_into().unwrap()) as usize;
        &region[start..start + size]
    }

    fn moof_of(payload: &[u8]) -> &[u8] {
        let size = u32::from_be_bytes(payload[0..4].try_into().unwrap()) as usize;
        &payload[..size]
    }

    fn mdat_body(payload: &[u8]) -> &[u8] {
        let moof = u32::from_be_bytes(payload[0..4].try_into().unwrap()) as usize;
        assert_eq!(&payload[moof + 4..moof + 8], b"mdat");
        &payload[moof + 8..]
    }

    fn mdat_nals(payload: &[u8]) -> Vec<&[u8]> {
        let body = mdat_body(payload);
        let mut nals = Vec::new();
        let mut i = 0usize;
        while i + 4 <= body.len() {
            let n = u32::from_be_bytes(body[i..i + 4].try_into().unwrap()) as usize;
            nals.push(&body[i + 4..i + 4 + n]);
            i += 4 + n;
        }
        nals
    }

    fn tfdt_of(payload: &[u8]) -> u64 {
        let b = find_box(moof_of(payload), b"tfdt");
        u64::from_be_bytes(b[12..20].try_into().unwrap())
    }

    /// `(data_offset, sample_duration, sample_size, sample_flags)`.
    fn trun_of(payload: &[u8]) -> (u32, u32, u32, u32) {
        let b = find_box(moof_of(payload), b"trun");
        let f = |r: std::ops::Range<usize>| u32::from_be_bytes(b[r].try_into().unwrap());
        (f(16..20), f(20..24), f(24..28), f(28..32))
    }

    #[test]
    fn frame_meta_config_then_keyframe_bootstraps_and_emits_init_once() {
        let mut stream = Vec::new();
        stream.extend_from_slice(&packet(CONFIG, 0, &config_payload()));
        stream.extend_from_slice(&packet(KEY, 0, &nal_stream(&[&IDR])));
        stream.extend_from_slice(&packet(0, 33_333, &nal_stream(&[&P_SLICE])));
        stream.extend_from_slice(&packet(0, 66_666, &nal_stream(&[&P_SLICE])));
        stream.extend_from_slice(&packet(CONFIG, 0, &config_payload()));
        stream.extend_from_slice(&packet(0, 99_999, &nal_stream(&[&P_SLICE])));

        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&stream, &mut out);
        a.finish(&mut out);

        assert!(a.is_bootstrapped());
        assert_eq!(out.len(), 5);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))), "init must lead the output");
        let inits = out.iter().filter(|f| matches!(decode_frame(f), Some(Frame::Init(_)))).count();
        assert_eq!(inits, 1, "a second CONFIG packet must not re-emit the init segment");
        let media = out.iter().filter(|f| matches!(decode_frame(f), Some(Frame::Media(_)))).count();
        assert_eq!(media, 4, "one media frame per media packet");
    }

    #[test]
    fn frame_meta_header_split_across_reads_reassembles() {
        let mut stream = Vec::new();
        stream.extend_from_slice(&packet(CONFIG, 0, &config_payload()));
        let key_at = stream.len();
        stream.extend_from_slice(&packet(KEY, 0, &nal_stream(&[&IDR])));
        stream.extend_from_slice(&packet(0, 33_333, &nal_stream(&[&P_SLICE])));

        let mut whole = StreamAssembler::default();
        let mut out_whole = Vec::new();
        whole.push_bytes(&stream, &mut out_whole);

        let mut split = StreamAssembler::default();
        let mut out_split = Vec::new();
        split.push_bytes(&stream[..key_at + 5], &mut out_split); // inside the 12-byte header
        split.push_bytes(&stream[key_at + 5..key_at + 14], &mut out_split); // inside the payload
        split.push_bytes(&stream[key_at + 14..], &mut out_split);

        assert_eq!(out_whole.len(), 3);
        assert_eq!(out_whole, out_split, "a packet split across reads must reassemble identically");
    }

    #[test]
    fn frame_meta_one_media_frame_per_access_unit() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&AUD, &SPS_HIGH_31, &PPS, &IDR])), &mut out);

        assert_eq!(out.len(), 2, "one access unit must produce exactly one media frame");
        let payload = media_payload(&out[1]);
        let nals = mdat_nals(payload);
        assert_eq!(nals.len(), 3, "the AUD must be dropped and every other NAL kept");
        assert_eq!(nals[0], SPS_HIGH_31);
        assert_eq!(nals[1], PPS);
        assert_eq!(nals[2], IDR);
        let (_, _, sample_size, _) = trun_of(payload);
        assert_eq!(sample_size as usize, mdat_body(payload).len(), "sample_size covers the whole access unit");
    }

    #[test]
    fn frame_meta_key_frame_flag_drives_sample_flags() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        a.push_bytes(&packet(0, 33_333, &nal_stream(&[&P_SLICE])), &mut out);

        assert_eq!(trun_of(media_payload(&out[1])).3, 0x0200_0000, "a key frame must be a sync sample");
        assert_eq!(trun_of(media_payload(&out[2])).3, 0x0101_0000, "a delta frame must not be a sync sample");
    }

    #[test]
    fn frame_meta_decode_times_are_monotonic_and_follow_pts() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        for (i, pts) in [0u64, 33_333, 66_666, 5_066_666, 5_100_000].into_iter().enumerate() {
            let (flags, nal): (u64, &[u8]) = if i == 0 { (KEY, &IDR) } else { (0, &P_SLICE) };
            a.push_bytes(&packet(flags, pts, &nal_stream(&[nal])), &mut out);
        }

        let media: Vec<&[u8]> = out.iter().skip(1).map(|f| media_payload(f)).collect();
        assert_eq!(media.len(), 5);
        let times: Vec<u64> = media.iter().map(|m| tfdt_of(m)).collect();
        assert_eq!(times, vec![0, 33_333, 66_666, 99_999, 199_999]);
        let durations: Vec<u32> = media.iter().map(|m| trun_of(m).1).collect();
        // 100_000 is the capped idle gap: a 5 s pause must not become a 5 s hole.
        assert_eq!(durations, vec![33_333, 33_333, 33_333, 100_000, 33_334]);
        assert!(times.windows(2).all(|w| w[1] > w[0]), "decode times must strictly increase");
    }

    #[test]
    fn frame_meta_session_packet_is_skipped() {
        // A session packet is its 12-byte header alone; the trailing u32 is not
        // a payload length and must not be consumed as one.
        let mut stream = Vec::new();
        stream.extend_from_slice(&SESSION.to_be_bytes());
        stream.extend_from_slice(&7u32.to_be_bytes());
        stream.extend_from_slice(&packet(CONFIG, 0, &config_payload()));
        stream.extend_from_slice(&packet(KEY, 0, &nal_stream(&[&IDR])));

        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&stream, &mut out);

        assert_eq!(out.len(), 2);
        assert!(matches!(decode_frame(&out[0]), Some(Frame::Init(_))));
        assert!(matches!(decode_frame(&out[1]), Some(Frame::Media(_))));
    }

    /// Regression guard for the black-video bug: if every media fragment has
    /// `sample_duration=0` and no `tfdt`, the MSE `buffered` range collapses to
    /// zero length and the `<video>` paints nothing (pure `bg-black`). Also
    /// pins `data_offset` against the moof this fragment actually built, so a
    /// box-layout change cannot leave it pointing into the middle of a box.
    #[test]
    fn append_access_unit_advances_tfdt_and_emits_nonzero_duration() {
        let mut b = Fmp4Builder::from_parameter_sets(&SPS_HIGH_31, &PPS).unwrap();
        let f1 = b.append_access_unit(&[IDR.as_slice()], true, 0);
        let f2 = b.append_access_unit(&[P_SLICE.as_slice()], false, 33_333);

        assert_eq!(f1[0], FRAME_MEDIA, "the discriminator is written in place");
        let p1 = media_payload(&f1);
        let p2 = media_payload(&f2);
        assert_eq!(&p1[4..8], b"moof");
        assert_eq!(tfdt_of(p1), 0, "first fragment must start at decode time 0");
        assert_eq!(tfdt_of(p2), 33_333, "decode time must advance by the previous duration");

        let (data_offset, duration, sample_size, flags) = trun_of(p1);
        assert!(duration > 0, "sample_duration=0 produces a zero-length buffered range");
        let moof_size = u32::from_be_bytes(p1[0..4].try_into().unwrap());
        assert_eq!(data_offset, moof_size + 8, "data_offset must point at the mdat body");
        assert_eq!(sample_size as usize, mdat_body(p1).len());
        assert_eq!(flags, 0x0200_0000);
        assert_eq!(trun_of(p2).3, 0x0101_0000);
    }

    #[test]
    fn assembler_stops_after_an_oversized_packet() {
        let mut header = Vec::new();
        header.extend_from_slice(&0u64.to_be_bytes());
        header.extend_from_slice(&((MAX_PACKET_BYTES + 1) as u32).to_be_bytes());

        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        assert_eq!(out.len(), 1);
        a.push_bytes(&header, &mut out);

        assert!(a.is_corrupt());
        assert_eq!(out.len(), 1, "nothing may be emitted from a desynchronized stream");
        // The terminal state is sticky: later bytes are dropped without parsing.
        a.push_bytes(&packet(KEY, 0, &nal_stream(&[&IDR])), &mut out);
        a.finish(&mut out);
        assert!(a.is_corrupt());
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn assembler_accepts_a_packet_at_the_size_limit() {
        let mut header = Vec::new();
        header.extend_from_slice(&0u64.to_be_bytes());
        header.extend_from_slice(&(MAX_PACKET_BYTES as u32).to_be_bytes());

        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&header, &mut out);
        assert!(!a.is_corrupt(), "the limit itself must be accepted, not rejected");
    }

    #[test]
    fn assembler_drops_a_truncated_trailing_packet_on_finish() {
        let mut a = StreamAssembler::default();
        let mut out = Vec::new();
        a.push_bytes(&packet(CONFIG, 0, &config_payload()), &mut out);
        let truncated = packet(KEY, 0, &nal_stream(&[&IDR]));
        a.push_bytes(&truncated[..truncated.len() - 3], &mut out);
        assert_eq!(out.len(), 1);
        a.finish(&mut out);
        assert_eq!(out.len(), 1, "half an access unit must never be muxed");
    }
}
