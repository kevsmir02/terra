use std::collections::{BTreeMap, BTreeSet};

use super::catalog::{self, ServiceId};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SiteKind {
    Php,
    Static,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteSpec {
    pub slug: String,
    pub root: String,
    pub docroot: String,
    pub port: u16,
    pub kind: SiteKind,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackSpec {
    pub services: Vec<ServiceId>,
    #[serde(default)]
    pub ports: BTreeMap<ServiceId, u16>,
    #[serde(default)]
    pub sites: Vec<SiteSpec>,
    pub db_password: String,
}

#[derive(Debug, Clone)]
pub struct ValidStack {
    pub services: Vec<ServiceId>,
    pub ports: BTreeMap<ServiceId, u16>,
    pub sites: Vec<SiteSpec>,
    pub db_password: String,
}

const MIN_PORT: u16 = 1025;

fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 63
        && s.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn valid_docroot(s: &str) -> bool {
    s == "."
        || (!s.starts_with('/')
            && !s.contains('\\')
            && s.split('/').all(|seg| !seg.is_empty() && seg != ".." && seg != "."))
}

fn valid_password(s: &str) -> bool {
    (16..=64).contains(&s.len())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn validate(spec: StackSpec) -> Result<ValidStack, String> {
    let enabled: BTreeSet<ServiceId> = spec.services.iter().copied().collect();

    if enabled.contains(&ServiceId::Adminer)
        && !enabled.iter().any(|id| catalog::is_database(*id))
    {
        return Err("Adminer needs a database enabled to connect to".into());
    }

    if !valid_password(&spec.db_password) {
        return Err(
            "database password must be 16 to 64 characters of A-Z a-z 0-9 _ -".into(),
        );
    }

    let mut used: BTreeMap<u16, String> = BTreeMap::new();
    let mut claim = |port: u16, owner: String| -> Result<(), String> {
        if port < MIN_PORT {
            return Err(format!("port {port} must be above 1024"));
        }
        if let Some(prev) = used.insert(port, owner.clone()) {
            return Err(format!("port {port} is claimed by both {prev} and {owner}"));
        }
        Ok(())
    };

    for id in &enabled {
        let d = catalog::def(*id);
        match spec.ports.get(id) {
            Some(p) => claim(*p, format!("{id:?}"))?,
            None => {
                for p in d.ports {
                    claim(*p, format!("{id:?}"))?;
                }
            }
        }
    }

    let mut slugs = BTreeSet::new();
    for site in &spec.sites {
        if !valid_slug(&site.slug) {
            return Err(format!("invalid site name: {:?}", site.slug));
        }
        if !slugs.insert(site.slug.clone()) {
            return Err(format!("duplicate site name: {}", site.slug));
        }
        if !valid_docroot(&site.docroot) {
            return Err(format!("invalid docroot for {}: {:?}", site.slug, site.docroot));
        }
        claim(site.port, format!("site {}", site.slug))?;
    }

    Ok(ValidStack {
        services: catalog::CATALOG
            .iter()
            .map(|d| d.id)
            .filter(|id| enabled.contains(id))
            .collect(),
        ports: spec.ports,
        sites: spec.sites,
        db_password: spec.db_password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> StackSpec {
        StackSpec {
            services: vec![ServiceId::Mariadb],
            ports: Default::default(),
            sites: vec![],
            db_password: "abcdefghijklmnop".into(),
        }
    }

    #[test]
    fn accepts_a_minimal_spec() {
        assert!(validate(base()).is_ok());
    }

    #[test]
    fn rejects_a_privileged_port() {
        let mut s = base();
        s.ports.insert(ServiceId::Mariadb, 80);
        // Every port must stay above 1024 so rootless podman works.
        assert!(validate(s).unwrap_err().contains("above 1024"));
    }

    #[test]
    fn rejects_duplicate_ports() {
        let mut s = base();
        s.services.push(ServiceId::Postgres);
        s.ports.insert(ServiceId::Mariadb, 9000);
        s.ports.insert(ServiceId::Postgres, 9000);
        assert!(validate(s).unwrap_err().contains("9000"));
    }

    #[test]
    fn rejects_adminer_without_a_database() {
        let s = StackSpec {
            services: vec![ServiceId::Adminer],
            ..base()
        };
        assert!(validate(s).unwrap_err().contains("database"));
    }

    #[test]
    fn rejects_a_slug_that_could_escape_a_path() {
        let long = "a".repeat(200);
        for bad in ["../evil", "a/b", "Foo Bar", "", "-lead", "café", &long] {
            let s = StackSpec {
                services: vec![ServiceId::Web],
                sites: vec![SiteSpec {
                    slug: bad.into(),
                    root: "/tmp/x".into(),
                    docroot: "public".into(),
                    port: 8000,
                    kind: SiteKind::Php,
                }],
                ..base()
            };
            assert!(validate(s).is_err(), "slug {bad:?} must be rejected");
        }
    }

    #[test]
    fn rejects_a_docroot_that_climbs_out() {
        let s = StackSpec {
            services: vec![ServiceId::Web],
            sites: vec![SiteSpec {
                slug: "app".into(),
                root: "/tmp/x".into(),
                docroot: "../../etc".into(),
                port: 8000,
                kind: SiteKind::Php,
            }],
            ..base()
        };
        assert!(validate(s).unwrap_err().contains("docroot"));
    }

    #[test]
    fn rejects_a_password_that_would_need_yaml_escaping() {
        let s = StackSpec { db_password: "pa'ss\nword".into(), ..base() };
        assert!(validate(s).is_err());
    }
}
