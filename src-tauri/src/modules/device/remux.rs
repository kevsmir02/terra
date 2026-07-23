/// Split an Annex-B byte stream into individual NAL unit byte strings (without
/// the start codes). Recognizes both the 4-byte `00 00 00 01` start code and
/// the 3-byte `00 00 01` start code per the H.264 spec. Pure function so the
/// parser is unit-testable without a live scrcpy socket.
pub fn split_nal_units(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut nals = Vec::new();
    let mut i = 0usize;
    let mut unit_start: Option<usize> = None;
    while i + 2 < bytes.len() {
        let is3 = bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 0x01;
        let is4 = i + 3 < bytes.len() && bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 0 && bytes[i + 3] == 0x01;
        if is4 {
            if let Some(start) = unit_start {
                nals.push(bytes[start..i].to_vec());
            }
            unit_start = Some(i + 4);
            i += 4;
        } else if is3 {
            if let Some(start) = unit_start {
                nals.push(bytes[start..i].to_vec());
            }
            unit_start = Some(i + 3);
            i += 3;
        } else {
            i += 1;
        }
    }
    if let Some(start) = unit_start {
        if start < bytes.len() {
            nals.push(bytes[start..].to_vec());
        }
    }
    nals
}

/// Pop complete NAL units from the front of `buf`, leaving the trailing
/// in-flight unit (bytes from the last start code onward, *including* its
/// start code) in `buf` for the next read. The streaming read loop uses this
/// because NALs may be split across `read()` calls. Initialize `buf` empty;
/// append each chunk, then call this to drain what is provably complete.
///
/// Only NALs bounded by two start codes are considered complete; with fewer
/// than two start codes nothing is drained (the whole `buf` is retained).
pub fn drain_complete_nals(buf: &mut Vec<u8>) -> Vec<Vec<u8>> {
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
        out.push(buf[start..end].to_vec());
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
/// CONTRACT (Rust↔TS codec-string handoff): the init segment emitted from the
/// read loop is a `DeviceFrame { kind: 0, bytes: … }` where `bytes` is laid out
/// as `[4-byte BE length][UTF-8 codec string, e.g. "avc1.42c029"][ftyp+moov]`.
/// Media fragments are `DeviceFrame { kind: 1, bytes: [moof+mdat] }`. See
/// `modules/device/MsePlayer.ts::pushData` for the consumer.
pub struct Fmp4Builder {
    codec_string: String,
    init_segment: Vec<u8>,
    sequence_number: u32,
}

impl Fmp4Builder {
    pub fn new(codec_string: String) -> Self {
        Self { codec_string, init_segment: Vec::new(), sequence_number: 0 }
    }

    pub fn codec_string(&self) -> &str { &self.codec_string }

    /// Build and cache the fMP4 init segment (`ftyp`+`moov`) from the first
    /// SPS+PPS NALs. `sps`/`pps` are the raw NAL payloads *without* the Annex-B
    /// start code but *with* the 1-byte NAL header (e.g. `0x67 …` for SPS), so
    /// `sps[1]` is `profile_idc` per ISO 14496-15.
    pub fn set_init_segment(&mut self, sps: &[u8], pps: &[u8]) {
        self.init_segment = build_init(sps, pps);
    }

    pub fn init_segment(&self) -> &[u8] { &self.init_segment }

    /// Wrap a single NAL (no start code) in its own fMP4 media fragment
    /// (`moof`+`mdat`). The `mdat` body is `[u32 BE length][nal]` (AVC length
    /// prefix = 4 bytes, matching the `lengthSizeMinusOne=3` stored in `avcC`).
    /// `mfhd` carries a per-session incrementing `sequence_number`.
    ///
    /// Sizes are constant for v1 (one sample per fragment, fixed box layout),
    /// so `trun`'s `data_offset` is a compile-time constant pointing at the
    /// `mdat` body start (just after the `mdat` box header).
    pub fn append_nal(&mut self, nal: &[u8]) -> Vec<u8> {
        self.sequence_number = self.sequence_number.wrapping_add(1);
        let seq = self.sequence_number;

        let mfhd = fullbox(b"mfhd", 0, 0, &seq.to_be_bytes());

        // default-base-is-moof (0x010000): trun data_offset is measured from the
        // first byte of the `moof` box, so we need no base_data_offset field.
        let mut tfhd_p = Vec::with_capacity(4);
        tfhd_p.extend_from_slice(&1u32.to_be_bytes()); // track_ID = 1
        let tfhd = fullbox(b"tfhd", 0, 0x010000, &tfhd_p);

        // trun flags: data-offset-present (0x000001) | sample-duration-present
        // (0x000100) | sample-size-present (0x000200) = 0x000301.
        // ponytail: sample_duration is a nominal 0 — we don't parse the slice
        // header for real timing; MSE tolerates this for a live append stream.
        // Upgrade path: extract frame-rate from the SPS VUI / slice header.
        const DATA_OFFSET: u32 = 84; // moof_total(76) + mdat header(8)
        let mut trun_p = Vec::with_capacity(16);
        trun_p.extend_from_slice(&1u32.to_be_bytes()); // sample_count
        trun_p.extend_from_slice(&DATA_OFFSET.to_be_bytes()); // data_offset
        trun_p.extend_from_slice(&0u32.to_be_bytes()); // sample_duration (nominal)
        trun_p.extend_from_slice(&((nal.len() as u32) + 4).to_be_bytes()); // sample_size (4-byte len + nal)
        let trun = fullbox(b"trun", 0, 0x000301, &trun_p);

        let mut traf_p = Vec::new();
        traf_p.extend_from_slice(&tfhd);
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
        out
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
fn build_init(sps: &[u8], pps: &[u8]) -> Vec<u8> {
    let mut ftyp_p = Vec::with_capacity(20);
    ftyp_p.extend_from_slice(b"iso5"); // major_brand
    ftyp_p.extend_from_slice(&0x200u32.to_be_bytes()); // minor_version
    ftyp_p.extend_from_slice(b"iso5"); // compatible_brands
    ftyp_p.extend_from_slice(b"iso6");
    ftyp_p.extend_from_slice(b"mp41");
    let ftyp = box_(b"ftyp", &ftyp_p);

    let moov = build_moov(sps, pps);

    let mut init = Vec::with_capacity(ftyp.len() + moov.len());
    init.extend_from_slice(&ftyp);
    init.extend_from_slice(&moov);
    init
}

fn build_moov(sps: &[u8], pps: &[u8]) -> Vec<u8> {
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
    let avc1 = build_avc1(sps, pps);
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
    box_(b"moov", &moov_p)
}

/// `avc1` VisualSampleEntry containing an `avcC` (AVCDecoderConfigurationRecord).
fn build_avc1(sps: &[u8], pps: &[u8]) -> Vec<u8> {
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
    p.extend_from_slice(&build_avcc(sps, pps));
    box_(b"avc1", &p)
}

/// `avcC` (AVCDecoderConfigurationRecord, ISO 14496-15).
fn build_avcc(sps: &[u8], pps: &[u8]) -> Vec<u8> {
    let mut p = Vec::with_capacity(34);
    p.push(1u8); // configurationVersion
    p.push(sps[1]); // AVCProfileIndication = profile_idc
    p.push(sps[2]); // profile_compatibility
    p.push(sps[3]); // AVCLevelIndication = level_idc
    p.push(0xFF); // reserved(6)=0x3F + lengthSizeMinusOne(2)=3 → 4-byte NAL length
    p.push(0xE1); // reserved(3)=0x7 + numOfSequenceParameterSets = 1
    p.extend_from_slice(&(sps.len() as u16).to_be_bytes()); // SPS length (BE)
    p.extend_from_slice(sps); // SPS NAL (incl. 0x67 header byte)
    p.push(1u8); // numOfPictureParameterSets = 1
    p.extend_from_slice(&(pps.len() as u16).to_be_bytes()); // PPS length (BE)
    p.extend_from_slice(pps); // PPS NAL (incl. 0x68 header byte)
    box_(b"avcC", &p)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}