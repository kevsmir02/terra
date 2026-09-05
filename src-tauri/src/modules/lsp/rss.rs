
pub fn rss_bytes(pid: u32) -> Option<u64> {
    let statm = std::fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
    let pages: u64 = statm.split_whitespace().nth(1)?.parse().ok()?;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page_size <= 0 {
        return None;
    }
    Some(pages * page_size as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rss_of_self_is_nonzero() {
        let rss = rss_bytes(std::process::id()).expect("own rss must resolve");
        assert!(rss > 1024 * 1024, "own rss suspiciously small: {rss}");
    }

    #[test]
    fn rss_of_bogus_pid_is_none() {
        assert_eq!(rss_bytes(0xFFFF_FFFE), None);
    }
}
