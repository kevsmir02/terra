#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ServiceStatus {
    pub service: String,
    pub state: String,
    pub health: Option<String>,
}

#[derive(serde::Deserialize)]
struct PsRow {
    #[serde(rename = "Service")]
    service: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Health", default)]
    health: Option<String>,
}

impl From<PsRow> for ServiceStatus {
    fn from(r: PsRow) -> Self {
        Self {
            service: r.service,
            state: r.state,
            health: r.health.filter(|h| !h.is_empty()),
        }
    }
}

pub fn parse_ps(out: &str) -> Vec<ServiceStatus> {
    let trimmed = out.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if let Ok(rows) = serde_json::from_str::<Vec<PsRow>>(trimmed) {
        return rows.into_iter().map(Into::into).collect();
    }
    trimmed
        .lines()
        .filter_map(|line| serde_json::from_str::<PsRow>(line.trim()).ok())
        .map(Into::into)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const ARRAY: &str = r#"[{"Service":"mariadb","State":"running","Health":"healthy"},
{"Service":"redis","State":"exited","Health":""}]"#;

    const NDJSON: &str = r#"{"Service":"mariadb","State":"running","Health":"starting"}
{"Service":"redis","State":"running","Health":""}"#;

    #[test]
    fn parses_the_json_array_shape() {
        let rows = parse_ps(ARRAY);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].service, "mariadb");
        assert_eq!(rows[0].health.as_deref(), Some("healthy"));
        assert_eq!(rows[1].state, "exited");
        assert_eq!(rows[1].health, None);
    }

    #[test]
    fn parses_the_newline_delimited_shape() {
        let rows = parse_ps(NDJSON);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].health.as_deref(), Some("starting"));
    }

    #[test]
    fn skips_malformed_lines_instead_of_losing_the_response() {
        let out = format!("not json\n{NDJSON}");
        assert_eq!(parse_ps(&out).len(), 2);
    }

    #[test]
    fn returns_empty_for_empty_output() {
        assert!(parse_ps("").is_empty());
        assert!(parse_ps("   \n ").is_empty());
    }
}
