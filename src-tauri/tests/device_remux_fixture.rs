// Integration test: feed the captured real-device Annex-B fixture through the
// fMP4 muxer and assert the produced boxes are structurally correct. The
// fixture is 5409 bytes of Annex-B H.264 from an Android 14 emulator:
//   start+SPS(67 42 c0 29 …)  start+PPS(68 ce 01 a8 35 c8)  start+IDR(65 …)

use std::path::PathBuf;

use terra_lib::modules::device::remux::{decode_frame, Fmp4Builder, Frame, FRAME_MEDIA};

fn fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("scrcpy-annexb-sample.bin")
}

/// Annex-B NAL boundary scanner for this fixture's 4-byte start codes only.
/// `remux`'s own splitter is private (framing is an internal assembler
/// concern), so this test isolates the known SPS/PPS/IDR triplet on its own
/// to exercise `Fmp4Builder` directly against real captured bytes.
/// The fixture predates frame metadata: it is a bare Annex-B capture, used
/// here for its real SPS/PPS/IDR bytes rather than for its framing.
fn split_4byte_start_codes(bytes: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    for i in 0..bytes.len().saturating_sub(3) {
        if bytes[i] == 0 && bytes[i + 1] == 0 && bytes[i + 2] == 0 && bytes[i + 3] == 1 {
            starts.push(i + 4);
        }
    }
    starts
        .iter()
        .enumerate()
        .map(|(idx, &start)| {
            let end = starts.get(idx + 1).map_or(bytes.len(), |&next| next - 4);
            &bytes[start..end]
        })
        .collect()
}

#[test]
fn device_remux_fixture_produces_valid_init_and_fragment() {
    let bytes = std::fs::read(fixture_path()).expect("fixture must exist");
    assert_eq!(bytes.len(), 5409);

    let nals = split_4byte_start_codes(&bytes);
    assert_eq!(nals.len(), 3, "fixture must contain SPS + PPS + IDR NALs");
    let sps = nals[0];
    let pps = nals[1];
    let idr = nals[2];

    // Sanity: SPS type 7, PPS type 8, IDR type 5.
    assert_eq!(sps[0] & 0x1F, 7);
    assert_eq!(pps[0] & 0x1F, 8);
    assert_eq!(idr[0] & 0x1F, 5);

    let mut builder = Fmp4Builder::from_parameter_sets(sps, pps).expect("fixture SPS+PPS are usable");

    let init = builder.init_segment();
    assert!(!init.is_empty(), "init segment must be non-empty");
    // Box layout: [u32 BE size][4-char type]. Bytes 4-8 = the box type.
    assert_eq!(&init[4..8], b"ftyp", "init must start with an ftyp box");

    // Locate the avcC box anywhere in the init and extract the codec string.
    let avcc_type_idx = init
        .windows(4)
        .position(|w| w == b"avcC")
        .expect("init must contain an avcC box");
    // The `avcC` *type* field sits at `avcc_type_idx`; the record body starts
    // immediately after those 4 type bytes (the box's own [size][type] header is
    // [size:4][type:4], so the record begins at type_idx + 4):
    //   [configVer][profile][compat][level][0xFF][0xE1][sps_len:u16]…
    let body = avcc_type_idx + 4;
    assert_eq!(init[body], 1, "configurationVersion == 1");
    let codec = format!("avc1.{:02x}{:02x}{:02x}", init[body + 1], init[body + 2], init[body + 3]);
    assert_eq!(codec, "avc1.42c029");
    assert_eq!(builder.codec_string(), "avc1.42c029");

    // The SPS/PPS embedded in avcC must match the fixture exactly.
    assert_eq!(init[body + 4], 0xFF, "reserved + lengthSizeMinusOne=3");
    assert_eq!(init[body + 5], 0xE1, "reserved + numSPS=1");
    let sps_len = u16::from_be_bytes([init[body + 6], init[body + 7]]) as usize;
    assert_eq!(sps_len, sps.len());
    assert_eq!(&init[body + 8..body + 8 + sps_len], sps);
    let pps_off = body + 8 + sps_len;
    assert_eq!(init[pps_off], 1, "numPPS == 1");
    let pps_len = u16::from_be_bytes([init[pps_off + 1], init[pps_off + 2]]) as usize;
    assert_eq!(pps_len, pps.len());
    assert_eq!(&init[pps_off + 3..pps_off + 3 + pps_len], pps);

    // Media fragment: the wire frame is [FRAME_MEDIA][moof+mdat].
    let frame = builder.append_access_unit(&[idr], true, 0);
    assert_eq!(frame[0], FRAME_MEDIA);
    let Some(Frame::Media(frag)) = decode_frame(&frame) else {
        panic!("append_access_unit must produce a media frame");
    };
    assert!(!frag.is_empty(), "fragment must be non-empty");
    assert_eq!(&frag[4..8], b"moof", "fragment must start with a moof box");

    // The moof must be followed directly by the mdat (offset 4-8 = "moof", and
    // the next box right after moof is mdat). Decode moof size to find mdat.
    let moof_size = u32::from_be_bytes([frag[0], frag[1], frag[2], frag[3]]) as usize;
    assert!(moof_size + 8 <= frag.len(), "moof + mdat header must fit in fragment");
    let mdat_type = &frag[moof_size + 4..moof_size + 8];
    assert_eq!(mdat_type, b"mdat", "fragment must be moof followed by mdat");

    // mdat body must be [u32 BE nal_length][idr bytes].
    let mdat_body = moof_size + 8;
    let nal_len = u32::from_be_bytes([
        frag[mdat_body],
        frag[mdat_body + 1],
        frag[mdat_body + 2],
        frag[mdat_body + 3],
    ]) as usize;
    assert_eq!(nal_len, idr.len(), "mdat length prefix must equal IDR NAL length");
    assert_eq!(&frag[mdat_body + 4..mdat_body + 4 + nal_len], idr);

    // trun's data_offset must point at that mdat body, computed from the moof
    // this fragment actually built rather than a fixed constant.
    let trun_at = frag.windows(4).position(|w| w == b"trun").expect("moof must carry a trun") - 4;
    let field = |off: usize| {
        u32::from_be_bytes([frag[off], frag[off + 1], frag[off + 2], frag[off + 3]])
    };
    assert_eq!(field(trun_at + 16), mdat_body as u32, "data_offset must point at the mdat body");
    assert_eq!(field(trun_at + 24) as usize, 4 + idr.len(), "sample_size covers the access unit");
    assert_eq!(field(trun_at + 28), 0x0200_0000, "an IDR access unit must be a sync sample");

    // The timescale is microseconds, so a second access unit captured 33_333 us
    // later starts exactly where the first one ended.
    let frame2 = builder.append_access_unit(&[idr], false, 33_333);
    let Some(Frame::Media(frag2)) = decode_frame(&frame2) else {
        panic!("append_access_unit must produce a media frame");
    };
    assert_eq!(&frag2[4..8], b"moof");
    let tfdt_at = frag2.windows(4).position(|w| w == b"tfdt").expect("traf must carry a tfdt") - 4;
    let decode_time = u64::from_be_bytes(frag2[tfdt_at + 12..tfdt_at + 20].try_into().unwrap());
    assert_eq!(decode_time, 33_333, "the second fragment starts where the first ended");
}