use std::collections::BTreeMap;
use std::fmt::Write as _;

use super::catalog::{self, ServiceId};
use super::spec::ValidStack;

pub struct RenderEnv {
    /// `Some((uid, gid))` renders `user:` on the PHP service. `None` omits it:
    /// Docker Desktop and rootless Podman both synthesize ownership, and
    /// setting it there breaks writes instead of fixing them.
    pub run_as: Option<(u32, u32)>,
    /// Site slug to canonical, already-authorized host path.
    pub mounts: BTreeMap<String, String>,
}

pub fn port_of(stack: &ValidStack, id: ServiceId, index: usize) -> u16 {
    stack
        .ports
        .get(&id)
        .copied()
        .unwrap_or_else(|| catalog::def(id).ports[index])
}

fn service_name(id: ServiceId) -> &'static str {
    match id {
        ServiceId::Mariadb => "mariadb",
        ServiceId::Postgres => "postgres",
        ServiceId::Redis => "redis",
        ServiceId::Mailpit => "mailpit",
        ServiceId::Adminer => "adminer",
        ServiceId::Web => "nginx",
    }
}

fn publish(out: &mut String, host: u16, container: u16) {
    let _ = writeln!(out, "      - \"127.0.0.1:{host}:{container}\"");
}

pub fn render_compose(stack: &ValidStack, env: &RenderEnv) -> String {
    let _ = env;
    let mut out = String::from("name: terra\n\nservices:\n");

    for id in &stack.services {
        let d = catalog::def(*id);
        let name = service_name(*id);
        let _ = writeln!(out, "  {name}:");
        let _ = writeln!(out, "    image: {}", d.image);
        let _ = writeln!(out, "    restart: unless-stopped");

        if !d.ports.is_empty() {
            let _ = writeln!(out, "    ports:");
            for (i, container) in d.ports.iter().enumerate() {
                publish(&mut out, port_of(stack, *id, i), *container);
            }
        }

        match id {
            ServiceId::Mariadb => {
                let _ = writeln!(out, "    environment:");
                let _ = writeln!(out, "      MARIADB_ROOT_PASSWORD: {}", stack.db_password);
                let _ = writeln!(out, "      MARIADB_DATABASE: terra");
                let _ = writeln!(out, "    volumes:");
                let _ = writeln!(out, "      - terra_mariadb_data:/var/lib/mysql");
            }
            ServiceId::Postgres => {
                let _ = writeln!(out, "    environment:");
                let _ = writeln!(out, "      POSTGRES_USER: terra");
                let _ = writeln!(out, "      POSTGRES_PASSWORD: {}", stack.db_password);
                let _ = writeln!(out, "      POSTGRES_DB: terra");
                let _ = writeln!(out, "    volumes:");
                let _ = writeln!(out, "      - terra_postgres_data:/var/lib/postgresql/data");
            }
            ServiceId::Adminer => {
                let target = if stack.services.contains(&ServiceId::Mariadb) {
                    "mariadb"
                } else {
                    "postgres"
                };
                let _ = writeln!(out, "    environment:");
                let _ = writeln!(out, "      ADMINER_DEFAULT_SERVER: {target}");
            }
            _ => {}
        }

        if let Some(cmd) = d.healthcheck {
            let _ = writeln!(out, "    healthcheck:");
            let _ = writeln!(out, "      test: [\"CMD-SHELL\", \"{cmd}\"]");
            let _ = writeln!(out, "      interval: 10s");
            let _ = writeln!(out, "      timeout: 5s");
            let _ = writeln!(out, "      retries: 5");
        }
        out.push('\n');
    }

    let volumes: Vec<&str> = stack
        .services
        .iter()
        .filter_map(|id| catalog::def(*id).volume)
        .collect();
    if !volumes.is_empty() {
        out.push_str("volumes:\n");
        for v in volumes {
            let _ = writeln!(out, "  {v}:");
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::services::spec::{validate, StackSpec};

    fn stack(services: Vec<ServiceId>) -> ValidStack {
        validate(StackSpec {
            services,
            ports: Default::default(),
            sites: vec![],
            db_password: "sixteencharacters".into(),
        })
        .unwrap()
    }

    fn plain() -> RenderEnv {
        RenderEnv { run_as: None, mounts: Default::default() }
    }

    #[test]
    fn publishes_every_port_on_loopback_only() {
        let out = render_compose(&stack(vec![ServiceId::Mariadb, ServiceId::Redis]), &plain());
        assert!(out.contains("\"127.0.0.1:3306:3306\""));
        assert!(out.contains("\"127.0.0.1:6379:6379\""));
        // A bare mapping would publish on every interface and bypass the host
        // firewall. This assertion is the regression test for that.
        assert!(!out.contains("\"3306:3306\""));
    }

    #[test]
    fn renders_only_enabled_services() {
        let out = render_compose(&stack(vec![ServiceId::Redis]), &plain());
        assert!(out.contains("  redis:"));
        assert!(!out.contains("  mariadb:"));
        assert!(!out.contains("  postgres:"));
    }

    #[test]
    fn is_deterministic_regardless_of_caller_order() {
        let a = render_compose(&stack(vec![ServiceId::Redis, ServiceId::Mariadb]), &plain());
        let b = render_compose(&stack(vec![ServiceId::Mariadb, ServiceId::Redis]), &plain());
        assert_eq!(a, b);
    }

    #[test]
    fn declares_a_named_volume_for_databases_only() {
        let out = render_compose(&stack(vec![ServiceId::Mariadb, ServiceId::Redis]), &plain());
        assert!(out.contains("terra_mariadb_data:"));
        assert!(!out.contains("terra_redis_data"));
    }

    #[test]
    fn applies_a_single_port_override() {
        let mut spec = StackSpec {
            services: vec![ServiceId::Mariadb],
            ports: Default::default(),
            sites: vec![],
            db_password: "sixteencharacters".into(),
        };
        spec.ports.insert(ServiceId::Mariadb, 3307);
        let out = render_compose(&validate(spec).unwrap(), &plain());
        assert!(out.contains("\"127.0.0.1:3307:3306\""));
        assert!(!out.contains("\"127.0.0.1:3306:3306\""));
    }

    #[test]
    fn points_adminer_at_mariadb_when_both_databases_are_enabled() {
        let out = render_compose(
            &stack(vec![ServiceId::Adminer, ServiceId::Mariadb, ServiceId::Postgres]),
            &plain(),
        );
        assert!(out.contains("ADMINER_DEFAULT_SERVER: mariadb"));
    }
}
