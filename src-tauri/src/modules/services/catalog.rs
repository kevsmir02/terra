#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServiceId {
    Mariadb,
    Postgres,
    Redis,
    Mailpit,
    Adminer,
    Web,
}

pub struct ServiceDef {
    pub id: ServiceId,
    pub image: &'static str,
    /// Default host ports. `Web` is empty: its ports come from the site list.
    pub ports: &'static [u16],
    pub volume: Option<&'static str>,
    pub healthcheck: Option<&'static str>,
}

// Tags are pinned. Verify each against current upstream releases before
// shipping, then bump them per Terra release rather than tracking `latest`.
pub const CATALOG: &[ServiceDef] = &[
    ServiceDef {
        id: ServiceId::Mariadb,
        image: "mariadb:11.8",
        ports: &[3306],
        volume: Some("terra_mariadb_data"),
        healthcheck: Some("healthcheck.sh --connect --innodb_initialized"),
    },
    ServiceDef {
        id: ServiceId::Postgres,
        image: "postgres:18-alpine",
        ports: &[5432],
        volume: Some("terra_postgres_data"),
        healthcheck: Some("pg_isready -U terra"),
    },
    ServiceDef {
        id: ServiceId::Redis,
        image: "redis:8.10-alpine",
        ports: &[6379],
        volume: None,
        healthcheck: Some("redis-cli ping"),
    },
    ServiceDef {
        id: ServiceId::Mailpit,
        image: "axllent/mailpit:v1.30.7",
        ports: &[8025, 1025],
        volume: None,
        healthcheck: None,
    },
    ServiceDef {
        id: ServiceId::Adminer,
        image: "adminer:5.5.1",
        ports: &[8026],
        volume: None,
        healthcheck: None,
    },
    ServiceDef {
        id: ServiceId::Web,
        image: "nginx:1.30-alpine",
        ports: &[],
        volume: None,
        healthcheck: None,
    },
];

pub fn def(id: ServiceId) -> &'static ServiceDef {
    CATALOG
        .iter()
        .find(|d| d.id == id)
        .expect("every ServiceId variant has a catalog entry")
}

pub fn is_database(id: ServiceId) -> bool {
    matches!(id, ServiceId::Mariadb | ServiceId::Postgres)
}
