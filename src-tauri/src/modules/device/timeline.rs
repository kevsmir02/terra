/// Nominal frame duration (microseconds) at scrcpy's 30 fps cap, used for the
/// first frame, which has no predecessor to measure a delta against.
pub const NOMINAL_FRAME_DURATION_US: u32 = 33_333;

/// Floor for a measured delta: a zero or backwards PTS must still advance the
/// timeline, or two samples would share a decode time.
pub const MIN_FRAME_DURATION_US: u32 = 1_000;

/// Ceiling for a measured delta, see `FrameTimeline`.
pub const MAX_FRAME_DURATION_US: u32 = 100_000;

/// Maps capture timestamps onto a contiguous fMP4 decode timeline: each sample
/// starts where the previous one ended, and a duration is the real PTS delta
/// clamped into `[MIN_FRAME_DURATION_US, MAX_FRAME_DURATION_US]`.
///
/// The cap exists because MSE treats a decode-time jump larger than twice the
/// previous frame's duration as a discontinuity and drops every non-keyframe
/// until the next IDR, which with scrcpy's 10 s keyframe interval blanks the
/// mirror for up to 10 s after an idle screen stops producing frames. Real
/// deltas rather than a fixed duration keep a stream that runs faster than the
/// nominal rate from accumulating lag against the capture clock.
#[derive(Default)]
pub struct FrameTimeline {
    previous: Option<Frame>,
}

struct Frame {
    pts_us: u64,
    decode_time_us: u64,
    duration_us: u32,
}

impl FrameTimeline {
    /// `(decode_time_us, duration_us)` for the frame captured at `pts_us`.
    pub fn next(&mut self, pts_us: u64) -> (u64, u32) {
        let (decode_time_us, duration_us) = match &self.previous {
            None => (0, NOMINAL_FRAME_DURATION_US),
            Some(previous) => {
                let delta = pts_us.saturating_sub(previous.pts_us);
                let duration = delta
                    .clamp(MIN_FRAME_DURATION_US as u64, MAX_FRAME_DURATION_US as u64)
                    as u32;
                (previous.decode_time_us + previous.duration_us as u64, duration)
            }
        };
        self.previous = Some(Frame { pts_us, decode_time_us, duration_us });
        (decode_time_us, duration_us)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_timeline_first_frame_starts_at_zero_with_the_nominal_duration() {
        let mut t = FrameTimeline::default();
        assert_eq!(t.next(0), (0, NOMINAL_FRAME_DURATION_US));

        // A stream whose first PTS is not zero must still anchor at zero.
        let mut offset = FrameTimeline::default();
        assert_eq!(offset.next(9_000_000), (0, NOMINAL_FRAME_DURATION_US));
    }

    #[test]
    fn frame_timeline_follows_a_fast_stream() {
        let mut t = FrameTimeline::default();
        assert_eq!(t.next(0), (0, 33_333));
        assert_eq!(t.next(16_000), (33_333, 16_000));
        assert_eq!(t.next(32_000), (49_333, 16_000));
        assert_eq!(t.next(48_000), (65_333, 16_000));
    }

    #[test]
    fn frame_timeline_follows_a_slow_stream() {
        let mut t = FrameTimeline::default();
        assert_eq!(t.next(0), (0, 33_333));
        assert_eq!(t.next(100_000), (33_333, 100_000));
        assert_eq!(t.next(200_000), (133_333, 100_000));
    }

    #[test]
    fn frame_timeline_caps_an_idle_gap() {
        let mut t = FrameTimeline::default();
        assert_eq!(t.next(0), (0, 33_333));
        assert_eq!(t.next(33_333), (33_333, 33_333));
        assert_eq!(t.next(10_033_333), (66_666, MAX_FRAME_DURATION_US));
        // Timeline time never runs ahead of real time, so the trim window the
        // player applies in seconds stays meaningful.
        assert_eq!(t.next(10_066_666), (166_666, 33_333));
    }

    #[test]
    fn frame_timeline_clamps_a_backwards_pts_to_the_minimum() {
        let mut t = FrameTimeline::default();
        assert_eq!(t.next(1_000_000), (0, 33_333));
        assert_eq!(t.next(500_000), (33_333, MIN_FRAME_DURATION_US));
        assert_eq!(t.next(500_000), (34_333, MIN_FRAME_DURATION_US));
        assert_eq!(t.next(600_000), (35_333, 100_000));
    }

    #[test]
    fn frame_timeline_decode_times_are_strictly_increasing() {
        let mut t = FrameTimeline::default();
        let mut previous = None;
        for pts in [0u64, 5, 33_333, 33_333, 0, 90_000_000, 90_000_001] {
            let (decode_time, _) = t.next(pts);
            if let Some(p) = previous {
                assert!(decode_time > p, "decode time must advance for every frame");
            }
            previous = Some(decode_time);
        }
    }
}
