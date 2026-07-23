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

/// Incremental fMP4 builder. v1 emits minimal `moof`/`mdat` fragments per NAL.
/// The init segment is populated from the first SPS+PPS NALs at runtime
/// (Task 5 stage 2) and cached; this struct's `init_segment` returns whatever
/// was last computed. See spec §Architecture ("remux.rs ≈50-150 LOC").
pub struct Fmp4Builder {
    codec_string: String,
    init_segment: Vec<u8>,
}

impl Fmp4Builder {
    pub fn new(codec_string: String) -> Self {
        Self { codec_string, init_segment: Vec::new() }
    }

    pub fn codec_string(&self) -> &str { &self.codec_string }

    /// Set the init segment bytes (ftyp+moov) computed from the first SPS+PPS
    /// NALs encountered. Called once during session bootstrap (Task 5).
    pub fn set_init_segment(&mut self, init: Vec<u8>) {
        self.init_segment = init;
    }

    pub fn init_segment(&self) -> &[u8] {
        &self.init_segment
    }

    /// v1 placeholder append: takes a NAL and returns fragment bytes that the
    /// MSE `SourceBuffer` accepts as a single complete `moof`+`mdat` segment.
    /// The implementing engineer fills this in alongside Task 5 stage 2.
    pub fn append_nal(&mut self, _nal: &[u8]) -> Vec<u8> {
        Vec::new()
    }
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
}
