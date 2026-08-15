# Local Hosting Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Terra an on-demand local web stack (nginx + PHP-FPM, MariaDB, PostgreSQL, Redis, Mailpit, Adminer) driven from a new Settings tab, backed by containers run through Docker or Podman.

**Architecture:** A new `src-tauri/src/modules/services/` module whose logic is pure functions (catalog, spec validation, compose rendering, vhost rendering, site detection, status parsing) with a thin IO shell (`runtime.rs`, `state.rs`, `commands.rs`). Terra generates a Compose project under `dirs::data_dir()/terra/services/` and shells out argv-style to `<docker|podman> compose`. The frontend owns configuration in the settings store and sends a full `StackSpec` on every call, which Rust revalidates from scratch.

**Tech Stack:** Rust (serde, serde_json, dirs, which, tempfile, all already in `src-tauri/Cargo.toml`, so **no new dependencies**), React 19 + TypeScript, shadcn/ui with hugeicons, `tauri-plugin-store`.

**Spec:** `docs/superpowers/specs/2026-08-15-local-hosting-services-design.md`

## Global Constraints

Copied verbatim from the spec and from TERRA.md. Every task's requirements implicitly include these.

- **No new Rust or npm dependencies.** Everything needed is already present.
- **No em-dash anywhere** in code, comments, commits or docs. **No emojis anywhere.**
- **No AI attribution in commits.** No `Co-Authored-By:` for any assistant, no "Generated with" line.
- **Comments:** default to none. If genuinely needed, 1-2 lines on *why*, never *what*.
- **Frontend imports are always `@/...`**, never relative across modules.
- **pnpm only**, never npm/npx/yarn.
- **Every published port renders as `127.0.0.1:<port>:<port>`.** A bare `3306:3306` bypasses the host firewall.
- **All generated files live under `dirs::data_dir()/terra/services/`**, never in the user's project.
- **Compose is invoked argv-style, never through a shell.**
- **The canonical path returned by `authorized_read` is the exact string written into the YAML.** Check and use must be the same string.
- **Ports are all above 1024** so rootless Podman works without privileged-port configuration.
- **Containers survive Terra exit.** `RunEvent::Exit` kills in-flight compose invocations only.
- Checks that must pass before any task is considered done:
  - `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`
  - `cd src-tauri && cargo nextest run --locked` (fallback `cargo test --locked`)
  - `pnpm lint` (runs with `--error-on-warnings`), `pnpm check-types`, `pnpm test`, `pnpm knip`

---

# Phase 1: Runtime detection and the Settings tab shell

## Task 1: Container runtime selection and probe

**Files:**
- Create: `src-tauri/src/modules/services/mod.rs`
- Create: `src-tauri/src/modules/services/runtime.rs`
- Create: `src-tauri/src/modules/services/commands.rs`
- Modify: `src-tauri/src/modules/mod.rs` (add `pub mod services;` in alphabetical order, between `proc` and `pty`)
- Modify: `src-tauri/src/lib.rs:271` (register `services::commands::services_runtime_probe` in `generate_handler!`)

**Interfaces:**
- Produces: `RuntimeKind::{Docker, Podman}` with `fn bin(self) -> &'static str`; `Probe::{Missing, NoCompose, Unreachable, Ready { version: String }}`; `pub fn select(docker: &Probe, podman: &Probe) -> RuntimeStatus`; `RuntimeStatus::{NotFound, NoCompose{runtime}, Unreachable{runtime}, Ready{runtime, version}}`; `#[tauri::command] pub async fn services_runtime_probe() -> RuntimeStatus`.

The probe is three steps because each failure needs a different message. `podman compose` delegates to an external provider, so a working `podman` with no provider is a real, distinguishable state.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/modules/services/runtime.rs` containing only the test module for now:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ready() -> Probe {
        Probe::Ready { version: "2.29.0".into() }
    }

    #[test]
    fn prefers_docker_when_both_are_ready() {
        assert_eq!(
            select(&ready(), &ready()),
            RuntimeStatus::Ready { runtime: RuntimeKind::Docker, version: "2.29.0".into() }
        );
    }

    #[test]
    fn falls_back_to_podman_when_docker_is_not_ready() {
        assert_eq!(
            select(&Probe::Unreachable, &ready()),
            RuntimeStatus::Ready { runtime: RuntimeKind::Podman, version: "2.29.0".into() }
        );
    }

    #[test]
    fn reports_the_most_actionable_failure() {
        // An unreachable daemon is one click from working; a missing compose
        // provider needs an install. Neither should be reported as "not found".
        assert_eq!(
            select(&Probe::Unreachable, &Probe::Missing),
            RuntimeStatus::Unreachable { runtime: RuntimeKind::Docker }
        );
        assert_eq!(
            select(&Probe::Missing, &Probe::NoCompose),
            RuntimeStatus::NoCompose { runtime: RuntimeKind::Podman }
        );
        assert_eq!(
            select(&Probe::NoCompose, &Probe::Unreachable),
            RuntimeStatus::Unreachable { runtime: RuntimeKind::Podman }
        );
    }

    #[test]
    fn reports_not_found_only_when_neither_binary_exists() {
        assert_eq!(select(&Probe::Missing, &Probe::Missing), RuntimeStatus::NotFound);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::runtime 2>&1 | head -30
```

Expected: FAIL to compile, `cannot find type Probe in this scope` (and `module services not found` until Step 3 wires `mod.rs`).

- [ ] **Step 3: Write the minimal implementation**

Create `src-tauri/src/modules/services/mod.rs`:

```rust
pub mod commands;
pub mod runtime;
```

Add to `src-tauri/src/modules/mod.rs`, keeping alphabetical order:

```rust
pub mod services;
```

Prepend to `src-tauri/src/modules/services/runtime.rs`, above the test module:

```rust
use std::process::Command;

use crate::modules::proc::hide_console;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeKind {
    Docker,
    Podman,
}

impl RuntimeKind {
    pub fn bin(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Podman => "podman",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Probe {
    Missing,
    NoCompose,
    Unreachable,
    Ready { version: String },
}

impl Probe {
    fn rank(&self) -> u8 {
        match self {
            Self::Missing => 0,
            Self::NoCompose => 1,
            Self::Unreachable => 2,
            Self::Ready { .. } => 3,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum RuntimeStatus {
    NotFound,
    NoCompose { runtime: RuntimeKind },
    Unreachable { runtime: RuntimeKind },
    Ready { runtime: RuntimeKind, version: String },
}

fn status_for(runtime: RuntimeKind, probe: &Probe) -> RuntimeStatus {
    match probe {
        Probe::Missing => RuntimeStatus::NotFound,
        Probe::NoCompose => RuntimeStatus::NoCompose { runtime },
        Probe::Unreachable => RuntimeStatus::Unreachable { runtime },
        Probe::Ready { version } => RuntimeStatus::Ready { runtime, version: version.clone() },
    }
}

/// Docker wins ties: it is the more common setup, and a tie means both are
/// equally close to working.
pub fn select(docker: &Probe, podman: &Probe) -> RuntimeStatus {
    if podman.rank() > docker.rank() {
        status_for(RuntimeKind::Podman, podman)
    } else {
        status_for(RuntimeKind::Docker, docker)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src-tauri && cargo test --locked services::runtime
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Add the IO probe and the command**

Append to `runtime.rs`, above the test module:

```rust
fn run(bin: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    hide_console(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn probe(runtime: RuntimeKind) -> Probe {
    let bin = runtime.bin();
    if which::which(bin).is_err() {
        return Probe::Missing;
    }
    let Some(version) = run(bin, &["compose", "version", "--short"]) else {
        return Probe::NoCompose;
    };
    if run(bin, &["info", "--format", "{{.ServerVersion}}"]).is_none() {
        return Probe::Unreachable;
    }
    Probe::Ready { version }
}

pub fn detect() -> RuntimeStatus {
    select(&probe(RuntimeKind::Docker), &probe(RuntimeKind::Podman))
}
```

Create `src-tauri/src/modules/services/commands.rs`:

```rust
use super::runtime::{self, RuntimeStatus};

#[tauri::command]
pub async fn services_runtime_probe() -> RuntimeStatus {
    tauri::async_runtime::spawn_blocking(runtime::detect)
        .await
        .unwrap_or(RuntimeStatus::NotFound)
}
```

Register it in `src-tauri/src/lib.rs` inside `tauri::generate_handler![...]`, next to the other module command groups:

```rust
            services::commands::services_runtime_probe,
```

- [ ] **Step 6: Verify the whole crate builds clean**

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked services::
```

Expected: no warnings, tests pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/modules/services src-tauri/src/modules/mod.rs src-tauri/src/lib.rs
git commit -m "feat(services): detect docker or podman with a three-step probe"
```

---

## Task 2: Services tab shell in Settings

**Files:**
- Modify: `src/modules/settings/openSettingsWindow.ts` (add `"services"` to the `SettingsTab` union)
- Modify: `src/settings/SettingsApp.tsx` (lazy import, `TABS` entry, `VALID_TABS` entry)
- Create: `src/settings/sections/ServicesSection.tsx`
- Create: `src/modules/services/index.ts`
- Create: `src/modules/services/RuntimeCard.tsx`
- Create: `src/modules/services/lib/runtime.ts`
- Create: `src/modules/services/RuntimeCard.test.ts`

**Interfaces:**
- Consumes: `services_runtime_probe` from Task 1, returning `{ state: "not-found" } | { state: "no-compose", runtime } | { state: "unreachable", runtime } | { state: "ready", runtime, version }`.
- Produces: `RuntimeStatus` TypeScript type in `@/modules/services/lib/runtime`; `probeRuntime(): Promise<RuntimeStatus>`; `<RuntimeCard />`.

The section is lazy-loaded exactly like `EditorSection`, so nothing here enters the eager settings-window graph.

- [ ] **Step 1: Write the failing test**

Create `src/modules/services/RuntimeCard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runtimeMessage } from "@/modules/services/lib/runtime";

describe("runtimeMessage", () => {
  it("distinguishes the three failure states", () => {
    expect(runtimeMessage({ state: "not-found" }).title).toBe(
      "No container runtime found",
    );
    expect(runtimeMessage({ state: "no-compose", runtime: "podman" }).title).toBe(
      "Podman has no compose provider",
    );
    expect(
      runtimeMessage({ state: "unreachable", runtime: "docker" }).title,
    ).toBe("Docker is not running");
  });

  it("reports the runtime and version when ready", () => {
    expect(
      runtimeMessage({ state: "ready", runtime: "docker", version: "2.29.0" })
        .title,
    ).toBe("Docker ready");
  });

  it("only marks the ready state as usable", () => {
    expect(runtimeMessage({ state: "ready", runtime: "podman", version: "1" }).ok).toBe(true);
    expect(runtimeMessage({ state: "unreachable", runtime: "podman" }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test src/modules/services/RuntimeCard.test.ts
```

Expected: FAIL, cannot resolve `@/modules/services/lib/runtime`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/services/lib/runtime.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export type RuntimeName = "docker" | "podman";

export type RuntimeStatus =
  | { state: "not-found" }
  | { state: "no-compose"; runtime: RuntimeName }
  | { state: "unreachable"; runtime: RuntimeName }
  | { state: "ready"; runtime: RuntimeName; version: string };

const LABEL: Record<RuntimeName, string> = {
  docker: "Docker",
  podman: "Podman",
};

export type RuntimeMessage = { title: string; detail: string; ok: boolean };

export function runtimeMessage(status: RuntimeStatus): RuntimeMessage {
  switch (status.state) {
    case "not-found":
      return {
        title: "No container runtime found",
        detail:
          "Install Docker Desktop or Podman to run local services. Terra never installs it for you.",
        ok: false,
      };
    case "no-compose":
      return {
        title: `${LABEL[status.runtime]} has no compose provider`,
        detail:
          "The runtime is installed but cannot run compose. Install the compose plugin, then probe again.",
        ok: false,
      };
    case "unreachable":
      return {
        title: `${LABEL[status.runtime]} is not running`,
        detail:
          status.runtime === "docker"
            ? "Start Docker Desktop, or run: systemctl --user start docker"
            : "Start the Podman service, or run: systemctl --user start podman.socket",
        ok: false,
      };
    case "ready":
      return {
        title: `${LABEL[status.runtime]} ready`,
        detail: `compose ${status.version}`,
        ok: true,
      };
  }
}

export function probeRuntime(): Promise<RuntimeStatus> {
  return invoke<RuntimeStatus>("services_runtime_probe");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test src/modules/services/RuntimeCard.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Build the card and the section**

Create `src/modules/services/RuntimeCard.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import {
  probeRuntime,
  runtimeMessage,
  type RuntimeStatus,
} from "@/modules/services/lib/runtime";
import { useCallback, useEffect, useState } from "react";

export function RuntimeCard({
  onStatus,
}: {
  onStatus: (s: RuntimeStatus | null) => void;
}) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const next = await probeRuntime();
      setStatus(next);
      onStatus(next);
    } finally {
      setBusy(false);
    }
  }, [onStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status) {
    return <div className="text-muted-foreground text-sm">Checking runtime</div>;
  }

  const msg = runtimeMessage(status);
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-medium text-sm">
            <span
              className={
                msg.ok
                  ? "size-2 rounded-full bg-emerald-500"
                  : "size-2 rounded-full bg-amber-500"
              }
            />
            {msg.title}
          </div>
          <p className="mt-1 text-muted-foreground text-xs">{msg.detail}</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={refresh}>
          Check again
        </Button>
      </div>
    </div>
  );
}
```

Create `src/modules/services/index.ts`:

```ts
export { RuntimeCard } from "./RuntimeCard";
export { probeRuntime, runtimeMessage } from "./lib/runtime";
export type { RuntimeStatus } from "./lib/runtime";
```

Create `src/settings/sections/ServicesSection.tsx`:

```tsx
import { RuntimeCard, type RuntimeStatus } from "@/modules/services";
import { useState } from "react";

export function ServicesSection() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const ready = status?.state === "ready";

  return (
    <div className="space-y-4">
      <RuntimeCard onStatus={setStatus} />
      {!ready && (
        <p className="text-muted-foreground text-xs">
          Services become available once a container runtime is ready.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire the tab**

In `src/modules/settings/openSettingsWindow.ts`, extend the union:

```ts
export type SettingsTab =
  | "general"
  | "editor"
  | "themes"
  | "services"
  | "shortcuts"
  | "about";
```

In `src/settings/SettingsApp.tsx`, add the lazy import next to the others:

```tsx
const ServicesSection = lazy(() =>
  import("./sections/ServicesSection").then((m) => ({
    default: m.ServicesSection,
  })),
);
```

Add `ServerStack01Icon` to the existing `@hugeicons/core-free-icons` import, add the `TABS` entry between `themes` and `shortcuts`:

```tsx
  {
    id: "services",
    label: "Services",
    icon: ServerStack01Icon,
    component: ServicesSection,
  },
```

and add `"services"` to `VALID_TABS` in the same position.

- [ ] **Step 7: Verify the eager budget still holds**

```bash
pnpm test src/app/eager-budget.test.ts && pnpm lint && pnpm check-types && pnpm knip
```

Expected: PASS. `eager-budget.test.ts` asserts the settings window pulls no heavy stacks eagerly; the lazy import keeps this section out of that graph.

- [ ] **Step 8: Commit**

```bash
git add src/modules/services src/settings src/modules/settings/openSettingsWindow.ts
git commit -m "feat(services): add a lazy Services tab with a runtime status card"
```

---

# Phase 2: Pure core for data services

## Task 3: Catalog and spec validation

**Files:**
- Create: `src-tauri/src/modules/services/catalog.rs`
- Create: `src-tauri/src/modules/services/spec.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`

**Interfaces:**
- Produces: `ServiceId::{Mariadb, Postgres, Redis, Mailpit, Adminer, Web}`; `ServiceDef { id, image, ports, volume, healthcheck }`; `pub const CATALOG: &[ServiceDef]`; `pub fn def(id: ServiceId) -> &'static ServiceDef`; `StackSpec { services, ports, sites, db_password }`; `SiteSpec { slug, root, docroot, port, kind }`; `SiteKind::{Php, Static}`; `pub fn validate(spec: StackSpec) -> Result<ValidStack, String>`; `ValidStack { services, ports, sites, db_password }`.

`Web` is one catalog entry that renders **two** compose services (nginx and php). PHP without nginx serves nothing, so exposing them as separate toggles would only let a user pick a broken combination.

The password alphabet is deliberately constrained so YAML escaping can never be wrong. Terra generates the password, so this costs nothing.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/modules/services/spec.rs` with only the test module:

```rust
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::spec 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find type StackSpec`.

- [ ] **Step 3: Write the catalog**

Create `src-tauri/src/modules/services/catalog.rs`:

```rust
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
        image: "mariadb:11.4",
        ports: &[3306],
        volume: Some("terra_mariadb_data"),
        healthcheck: Some("healthcheck.sh --connect --innodb_initialized"),
    },
    ServiceDef {
        id: ServiceId::Postgres,
        image: "postgres:17-alpine",
        ports: &[5432],
        volume: Some("terra_postgres_data"),
        healthcheck: Some("pg_isready -U terra"),
    },
    ServiceDef {
        id: ServiceId::Redis,
        image: "redis:7.4-alpine",
        ports: &[6379],
        volume: None,
        healthcheck: Some("redis-cli ping"),
    },
    ServiceDef {
        id: ServiceId::Mailpit,
        image: "axllent/mailpit:v1.21",
        ports: &[8025, 1025],
        volume: None,
        healthcheck: None,
    },
    ServiceDef {
        id: ServiceId::Adminer,
        image: "adminer:4",
        ports: &[8026],
        volume: None,
        healthcheck: None,
    },
    ServiceDef {
        id: ServiceId::Web,
        image: "nginx:1.27-alpine",
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
```

- [ ] **Step 4: Write the spec validation**

Prepend to `src-tauri/src/modules/services/spec.rs`:

```rust
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
```

Note the `services` field is rebuilt in `CATALOG` order, not caller order. That is what makes the compose renderer deterministic in Task 4.

Add to `src-tauri/src/modules/services/mod.rs`:

```rust
pub mod catalog;
pub mod spec;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::spec
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): add the service catalog and stack spec validation"
```

---

## Task 4: Compose renderer for data services

**Files:**
- Create: `src-tauri/src/modules/services/compose.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`

**Interfaces:**
- Consumes: `ValidStack`, `ServiceId`, `catalog::def` from Task 3.
- Produces: `RenderEnv { run_as: Option<(u32, u32)>, mounts: BTreeMap<String, String> }`; `pub fn render_compose(stack: &ValidStack, env: &RenderEnv) -> String`; `pub fn port_of(stack: &ValidStack, id: ServiceId, index: usize) -> u16`.

`RenderEnv` keeps the renderer pure: the caller decides whether uid mapping applies (Linux with Docker) or not (Docker Desktop and rootless Podman both synthesize ownership), rather than the renderer reading the ambient OS.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/modules/services/compose.rs`:

```rust
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
    fn points_adminer_at_mariadb_when_both_databases_are_enabled() {
        let out = render_compose(
            &stack(vec![ServiceId::Adminer, ServiceId::Mariadb, ServiceId::Postgres]),
            &plain(),
        );
        assert!(out.contains("ADMINER_DEFAULT_SERVER: mariadb"));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::compose 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function render_compose`.

- [ ] **Step 3: Write the minimal implementation**

Prepend to `src-tauri/src/modules/services/compose.rs`:

```rust
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
```

Add `pub mod compose;` to `src-tauri/src/modules/services/mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::compose
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): render a compose file for the data services"
```

---

## Task 5: Status parser

**Files:**
- Create: `src-tauri/src/modules/services/status.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`

**Interfaces:**
- Produces: `ServiceStatus { service: String, state: String, health: Option<String> }`; `pub fn parse_ps(out: &str) -> Vec<ServiceStatus>`.

`compose ps --format json` emits a JSON array in newer versions and newline-delimited objects in older ones, and Podman's provider may differ from Docker's. Both shapes must parse, and a malformed line must be skipped rather than losing the whole response.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/modules/services/status.rs` with only the test module:

```rust
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::status 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function parse_ps`.

- [ ] **Step 3: Write the minimal implementation**

Prepend to `status.rs`:

```rust
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
```

Add `pub mod status;` to `mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::status && cargo clippy --all-targets --locked -- -D warnings
```

Expected: PASS, 4 tests, no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): parse compose ps output in both array and ndjson shapes"
```

---

# Phase 3: Data services end to end

## Task 6: State, project directory and the up/down commands

**Files:**
- Create: `src-tauri/src/modules/services/state.rs`
- Create: `src-tauri/src/modules/services/project.rs`
- Modify: `src-tauri/src/modules/services/commands.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`
- Modify: `src-tauri/src/lib.rs` (manage `ServicesState`, register commands, kill in-flight work on `RunEvent::Exit`)

**Interfaces:**
- Consumes: `validate`, `render_compose`, `RenderEnv`, `RuntimeKind` from Tasks 1, 3, 4.
- Produces: `ServicesState` with `register(Child) -> u64`, `finish(u64)`, `kill_all()`; `pub fn project_dir() -> Result<PathBuf, String>`; `pub fn write_project(stack: &ValidStack, env: &RenderEnv) -> Result<PathBuf, String>`; `pub fn port_free(port: u16) -> bool`; commands `services_up`, `services_down`.

- [ ] **Step 1: Write the failing test**

Add to `src-tauri/src/modules/services/project.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bound_port_is_reported_as_busy() {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!port_free(port));
        drop(listener);
        assert!(port_free(port));
    }

    #[test]
    fn writing_the_project_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let a = write_compose_to(dir.path(), "name: terra\n").unwrap();
        let b = write_compose_to(dir.path(), "name: terra\n").unwrap();
        assert_eq!(a, b);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "name: terra\n");
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::project 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function port_free`.

- [ ] **Step 3: Write the project helpers**

Prepend to `project.rs`:

```rust
use std::path::{Path, PathBuf};

use super::compose::{render_compose, RenderEnv};
use super::spec::ValidStack;

pub fn project_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("no data directory for this platform")?;
    let dir = base.join("terra").join("services");
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn write_compose_to(dir: &Path, yaml: &str) -> Result<PathBuf, String> {
    let path = dir.join("compose.yaml");
    std::fs::write(&path, yaml).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path)
}

pub fn write_project(stack: &ValidStack, env: &RenderEnv) -> Result<PathBuf, String> {
    let dir = project_dir()?;
    write_compose_to(&dir, &render_compose(stack, env))?;
    Ok(dir)
}

pub fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::project
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Write the state holder**

Create `src-tauri/src/modules/services/state.rs`:

```rust
use std::collections::HashMap;
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::modules::sync::MutexExt;

#[derive(Default)]
pub struct ServicesState {
    inflight: Mutex<HashMap<u64, Child>>,
    next: AtomicU64,
}

impl ServicesState {
    pub fn register(&self, child: Child) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        self.inflight.lock_or_recover().insert(id, child);
        id
    }

    pub fn finish(&self, id: u64) -> Option<Child> {
        self.inflight.lock_or_recover().remove(&id)
    }

    /// Containers are deliberately left running. Only the compose CLI
    /// invocations Terra started are killed.
    pub fn kill_all(&self) {
        for (_, mut child) in self.inflight.lock_or_recover().drain() {
            let _ = child.kill();
        }
    }
}
```

- [ ] **Step 6: Write the up and down commands**

Replace `src-tauri/src/modules/services/commands.rs` with:

```rust
use tauri::State;

use super::compose::{port_of, RenderEnv};
use super::project::{port_free, project_dir, write_project};
use super::runtime::{self, RuntimeKind, RuntimeStatus};
use super::spec::{validate, StackSpec, ValidStack};
use super::state::ServicesState;
use crate::modules::proc::hide_console;

#[tauri::command]
pub async fn services_runtime_probe() -> RuntimeStatus {
    tauri::async_runtime::spawn_blocking(runtime::detect)
        .await
        .unwrap_or(RuntimeStatus::NotFound)
}

fn resolve_runtime() -> Result<RuntimeKind, String> {
    match runtime::detect() {
        RuntimeStatus::Ready { runtime, .. } => Ok(runtime),
        RuntimeStatus::NotFound => Err("no container runtime found".into()),
        RuntimeStatus::NoCompose { runtime } => {
            Err(format!("{} has no compose provider", runtime.bin()))
        }
        RuntimeStatus::Unreachable { runtime } => {
            Err(format!("{} is not running", runtime.bin()))
        }
    }
}

fn preflight(stack: &ValidStack) -> Result<(), String> {
    for id in &stack.services {
        for (i, _) in super::catalog::def(*id).ports.iter().enumerate() {
            let p = port_of(stack, *id, i);
            if !port_free(p) {
                return Err(format!(
                    "port {p} is already in use. Stop whatever is using it, or change the port."
                ));
            }
        }
    }
    for site in &stack.sites {
        if !port_free(site.port) {
            return Err(format!("port {} for site {} is already in use", site.port, site.slug));
        }
    }
    Ok(())
}

fn compose(
    state: &ServicesState,
    runtime: RuntimeKind,
    args: &[&str],
) -> Result<String, String> {
    let dir = project_dir()?;
    let mut cmd = std::process::Command::new(runtime.bin());
    cmd.arg("compose")
        .arg("--project-directory")
        .arg(&dir)
        .args(args)
        .current_dir(&dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("{}: {e}", runtime.bin()))?;

    // Take the pipes before handing the child to the registry: reading them
    // here is what lets the child stay registered (and therefore killable on
    // exit) for the whole invocation, instead of being owned by wait_with_output.
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let id = state.register(child);

    let mut out = String::new();
    if let Some(pipe) = stdout.as_mut() {
        let _ = std::io::Read::read_to_string(pipe, &mut out);
    }
    let mut err = String::new();
    if let Some(pipe) = stderr.as_mut() {
        let _ = std::io::Read::read_to_string(pipe, &mut err);
    }

    let Some(mut child) = state.finish(id) else {
        return Err("compose invocation was cancelled".into());
    };
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(err.trim().to_string());
    }
    Ok(out)
}

#[tauri::command]
pub async fn services_up(
    spec: StackSpec,
    state: State<'_, ServicesState>,
) -> Result<(), String> {
    let stack = validate(spec)?;
    let runtime = resolve_runtime()?;
    preflight(&stack)?;
    let env = RenderEnv { run_as: None, mounts: Default::default() };
    write_project(&stack, &env)?;
    compose(&state, runtime, &["up", "-d"])?;
    Ok(())
}

#[tauri::command]
pub async fn services_down(
    spec: StackSpec,
    state: State<'_, ServicesState>,
) -> Result<(), String> {
    let _ = validate(spec)?;
    let runtime = resolve_runtime()?;
    compose(&state, runtime, &["down"])?;
    Ok(())
}
```

Add `pub mod project;` and `pub mod state;` to `mod.rs`.

- [ ] **Step 7: Wire lib.rs**

In `src-tauri/src/lib.rs`, add next to the other `.manage(...)` calls around line 255:

```rust
        .manage(services::state::ServicesState::default())
```

Add to `generate_handler![...]`:

```rust
            services::commands::services_up,
            services::commands::services_down,
```

Add to the `RunEvent::Exit` arm, next to the LSP and device cleanup:

```rust
                    // Containers are deliberately left running; only Terra's
                    // own in-flight compose invocations are killed.
                    if let Some(state) = app.try_state::<services::state::ServicesState>() {
                        state.kill_all();
                    }
```

- [ ] **Step 8: Verify**

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked services::
```

Expected: no warnings, all services tests pass.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/modules/services src-tauri/src/lib.rs
git commit -m "feat(services): start and stop the stack through compose"
```

---

## Task 7: Status, logs and volume deletion commands

**Files:**
- Modify: `src-tauri/src/modules/services/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register three commands)

**Interfaces:**
- Consumes: `compose()` helper and `resolve_runtime()` from Task 6, `parse_ps` from Task 5.
- Produces: `services_status() -> Vec<ServiceStatus>`; `services_logs(service: String) -> String`; `services_delete_data(volume: String) -> ()`.

Logs are fetched on demand rather than streamed. Terra is a terminal: a live tail belongs in a terminal tab running `compose logs -f`, not reimplemented inside a settings panel.

- [ ] **Step 1: Write the failing test**

Add to the existing test module in `src-tauri/src/modules/services/commands.rs` (create the module if absent):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_terra_owned_volumes_can_be_deleted() {
        assert!(check_volume("terra_mariadb_data").is_ok());
        assert!(check_volume("terra_postgres_data").is_ok());
        // A volume name arriving from IPC must not be able to name someone
        // else's data.
        assert!(check_volume("postgres_data").is_err());
        assert!(check_volume("terra_mariadb_data extra").is_err());
        assert!(check_volume("../etc").is_err());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::commands 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function check_volume`.

- [ ] **Step 3: Write the minimal implementation**

Add to `commands.rs`, above the test module:

```rust
use super::status::{parse_ps, ServiceStatus};

fn check_volume(name: &str) -> Result<(), String> {
    let known = super::catalog::CATALOG
        .iter()
        .filter_map(|d| d.volume)
        .any(|v| v == name);
    if known {
        Ok(())
    } else {
        Err(format!("unknown volume: {name}"))
    }
}

#[tauri::command]
pub async fn services_status(
    state: State<'_, ServicesState>,
) -> Result<Vec<ServiceStatus>, String> {
    let runtime = resolve_runtime()?;
    let out = compose(&state, runtime, &["ps", "--format", "json"])?;
    Ok(parse_ps(&out))
}

#[tauri::command]
pub async fn services_logs(
    service: String,
    state: State<'_, ServicesState>,
) -> Result<String, String> {
    let known = super::catalog::CATALOG
        .iter()
        .any(|d| format!("{:?}", d.id).to_lowercase() == service.to_lowercase());
    if !known && service != "nginx" && service != "php" {
        return Err(format!("unknown service: {service}"));
    }
    let runtime = resolve_runtime()?;
    compose(&state, runtime, &["logs", "--tail", "200", "--no-color", &service])
}

#[tauri::command]
pub async fn services_delete_data(
    volume: String,
    state: State<'_, ServicesState>,
) -> Result<(), String> {
    check_volume(&volume)?;
    let runtime = resolve_runtime()?;
    compose(&state, runtime, &["down", "-v"])?;
    Ok(())
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd src-tauri && cargo test --locked services::commands
```

Expected: PASS, 1 test.

- [ ] **Step 5: Register the commands**

In `src-tauri/src/lib.rs` `generate_handler![...]`:

```rust
            services::commands::services_status,
            services::commands::services_logs,
            services::commands::services_delete_data,
```

- [ ] **Step 6: Verify and commit**

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked services::
git add src-tauri/src/modules/services src-tauri/src/lib.rs
git commit -m "feat(services): add status, on-demand logs and volume deletion"
```

---

## Task 8: Service rows, connection details and logs drawer

**Files:**
- Create: `src/modules/services/lib/config.ts`
- Create: `src/modules/services/lib/connection.ts`
- Create: `src/modules/services/lib/connection.test.ts`
- Create: `src/modules/services/ServiceRow.tsx`
- Create: `src/modules/services/LogsDrawer.tsx`
- Modify: `src/modules/services/index.ts`
- Modify: `src/settings/sections/ServicesSection.tsx`
- Modify: `src/modules/settings/store.ts` (add the `services` key)

**Interfaces:**
- Consumes: `services_up`, `services_down`, `services_status`, `services_logs`, `services_delete_data`.
- Produces: `ServicesConfig { services: ServiceId[]; ports: Record<string, number>; sites: SiteConfig[]; dbPassword: string }`; `connectionString(id, port, password): string`; `generatePassword(): string`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/services/lib/connection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  connectionString,
  generatePassword,
} from "@/modules/services/lib/connection";

describe("connectionString", () => {
  it("builds a pasteable DSN per engine", () => {
    expect(connectionString("mariadb", 3306, "secret")).toBe(
      "mysql://root:secret@127.0.0.1:3306/terra",
    );
    expect(connectionString("postgres", 5432, "secret")).toBe(
      "postgresql://terra:secret@127.0.0.1:5432/terra",
    );
    expect(connectionString("redis", 6379, "secret")).toBe(
      "redis://127.0.0.1:6379",
    );
  });

  it("has no DSN for the web UIs", () => {
    expect(connectionString("mailpit", 8025, "secret")).toBeNull();
    expect(connectionString("adminer", 8026, "secret")).toBeNull();
  });
});

describe("generatePassword", () => {
  it("only emits characters that never need YAML escaping", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test src/modules/services/lib/connection.test.ts
```

Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/services/lib/connection.ts`:

```ts
export type ServiceId =
  | "mariadb"
  | "postgres"
  | "redis"
  | "mailpit"
  | "adminer"
  | "web";

export function connectionString(
  id: ServiceId,
  port: number,
  password: string,
): string | null {
  switch (id) {
    case "mariadb":
      return `mysql://root:${password}@127.0.0.1:${port}/terra`;
    case "postgres":
      return `postgresql://terra:${password}@127.0.0.1:${port}/terra`;
    case "redis":
      return `redis://127.0.0.1:${port}`;
    default:
      return null;
  }
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** The alphabet is constrained so the password can never need YAML escaping
 * when it is written into the generated compose file. */
export function generatePassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test src/modules/services/lib/connection.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Add the settings-store key**

In `src/modules/settings/store.ts`, add alongside the other `KEY_` constants:

```ts
const KEY_SERVICES = "services";
```

Add to the `Preferences` type and `DEFAULT_PREFERENCES`:

```ts
  services: ServicesConfig;
```

```ts
  services: { services: [], ports: {}, sites: [], dbPassword: "" },
```

Add the type export and setter, following `setLspActivation`:

```ts
export type ServicesConfig = {
  services: string[];
  ports: Record<string, number>;
  sites: {
    slug: string;
    root: string;
    docroot: string;
    port: number;
    kind: "php" | "static";
  }[];
  dbPassword: string;
};

export async function setServicesConfig(value: ServicesConfig): Promise<void> {
  await writePref(KEY_SERVICES, value);
}
```

Read it in `loadPreferences`:

```ts
    services: get<ServicesConfig>(KEY_SERVICES) ?? DEFAULT_PREFERENCES.services,
```

- [ ] **Step 6: Build the row, the drawer and the section**

Create `src/modules/services/ServiceRow.tsx` with this shape:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  connectionString,
  type ServiceId,
} from "@/modules/services/lib/connection";

export type RowStatus = "stopped" | "starting" | "healthy" | "unhealthy";

export function statusColor(s: RowStatus): string {
  switch (s) {
    case "healthy":
      return "bg-emerald-500";
    case "starting":
      return "bg-amber-500";
    case "unhealthy":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}

export function ServiceRow({
  id,
  label,
  port,
  status,
  enabled,
  busy,
  password,
  onToggle,
  onPortChange,
  onOpen,
  onDeleteData,
}: {
  id: ServiceId;
  label: string;
  port: number;
  status: RowStatus;
  enabled: boolean;
  busy: boolean;
  password: string;
  onToggle: (next: boolean) => void;
  onPortChange: (next: number) => void;
  onOpen: () => void;
  onDeleteData: () => void;
}) {
  const dsn = connectionString(id, port, password);
  const isWebUi = id === "mailpit" || id === "adminer";

  return (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2">
      <span className={`size-2 rounded-full ${statusColor(status)}`} />
      <span className="min-w-28 font-medium text-sm">{label}</span>
      <Input
        className="h-7 w-24"
        type="number"
        value={port}
        disabled={enabled}
        onChange={(e) => onPortChange(Number(e.target.value))}
      />
      {busy && (
        <span className="text-muted-foreground text-xs">
          {id === "web" ? "Building PHP image, one time only" : "Working"}
        </span>
      )}
      {dsn && status === "healthy" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void navigator.clipboard.writeText(dsn)}
        >
          Copy connection string
        </Button>
      )}
      {isWebUi && status === "healthy" && (
        <Button size="sm" variant="ghost" onClick={onOpen}>
          Open
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={onDeleteData}
      >
        Delete data
      </Button>
      <Switch
        className="ml-auto"
        checked={enabled}
        disabled={busy}
        onCheckedChange={onToggle}
      />
    </div>
  );
}
```

Add a `statusColor` unit test alongside `connection.test.ts` covering all four states. Put the "Delete data" button behind an `AlertDialog` from `src/components/ui/` whose body names the exact volume (`terra_mariadb_data`), since the spec requires deletion to be explicitly confirmed and never implied by stopping a service.

Create `src/modules/services/LogsDrawer.tsx`: a `Collapsible` holding a `<pre>` of the string from `services_logs`, a Refresh `Button`, and the line `For a live tail, run: docker compose logs -f <service>` in a terminal.

Rewrite `src/settings/sections/ServicesSection.tsx` to render `RuntimeCard`, then, only when the runtime is ready, the rows from the catalog plus the `LogsDrawer`. All toggles write through `setServicesConfig` and then call `services_up` or `services_down` with the full config plus a `dbPassword` generated by `generatePassword()` on first use.

Export the new components from `src/modules/services/index.ts`.

- [ ] **Step 7: Verify the full frontend check suite**

```bash
pnpm lint && pnpm check-types && pnpm test && pnpm knip
```

Expected: all pass. `pnpm knip` catches anything exported from the barrel but unused.

- [ ] **Step 8: Manual verification**

```bash
pnpm tauri dev
```

Open Settings, go to Services, enable MariaDB, wait for the health dot to turn green, then confirm from a terminal:

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p terra -e "select 1"
```

Expected: connects using the password shown in the tab.

- [ ] **Step 9: Commit**

```bash
git add src/modules/services src/settings src/modules/settings/store.ts
git commit -m "feat(services): add service rows, connection details and a logs drawer"
```

---

# Phase 4: Pure core for the web tier

## Task 9: Site detection

**Files:**
- Create: `src-tauri/src/modules/services/detect.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`

**Interfaces:**
- Produces: `DetectedSite { kind: SiteKind, docroot: String, confident: bool }`; `pub fn detect_site(files: &BTreeSet<String>, dirs: &BTreeSet<String>) -> DetectedSite`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/modules/services/detect.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn set(items: &[&str]) -> BTreeSet<String> {
        items.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn laravel_wins_over_the_node_marker_it_also_has() {
        // Every Laravel project has package.json too. Resolving it as a Node
        // project would serve nothing.
        let got = detect_site(&set(&["artisan", "composer.json", "package.json"]), &set(&["public"]));
        assert_eq!(got.kind, SiteKind::Php);
        assert_eq!(got.docroot, "public");
        assert!(got.confident);
    }

    #[test]
    fn composer_without_a_public_dir_serves_the_root() {
        let got = detect_site(&set(&["composer.json"]), &set(&[]));
        assert_eq!(got.kind, SiteKind::Php);
        assert_eq!(got.docroot, ".");
    }

    #[test]
    fn a_bare_index_php_is_a_php_site() {
        let got = detect_site(&set(&["index.php"]), &set(&[]));
        assert_eq!(got.kind, SiteKind::Php);
    }

    #[test]
    fn an_index_html_is_a_static_site() {
        let got = detect_site(&set(&["index.html"]), &set(&[]));
        assert_eq!(got.kind, SiteKind::Static);
        assert!(got.confident);
    }

    #[test]
    fn an_unrecognised_directory_is_a_flagged_guess() {
        let got = detect_site(&set(&["README.md"]), &set(&["src"]));
        assert_eq!(got.kind, SiteKind::Static);
        assert!(!got.confident);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::detect 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function detect_site`.

- [ ] **Step 3: Write the minimal implementation**

Prepend to `detect.rs`:

```rust
use std::collections::BTreeSet;

use super::spec::SiteKind;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSite {
    pub kind: SiteKind,
    pub docroot: String,
    /// False when nothing matched and the result is a fallback guess, so the
    /// UI can say so instead of pretending.
    pub confident: bool,
}

fn php(docroot: &str) -> DetectedSite {
    DetectedSite { kind: SiteKind::Php, docroot: docroot.into(), confident: true }
}

pub fn detect_site(files: &BTreeSet<String>, dirs: &BTreeSet<String>) -> DetectedSite {
    let has = |f: &str| files.contains(f);
    let public = dirs.contains("public");

    if (has("artisan") || has("composer.json")) && public {
        return php("public");
    }
    if has("composer.json") || has("index.php") {
        return php(".");
    }
    if has("index.html") {
        return DetectedSite {
            kind: SiteKind::Static,
            docroot: ".".into(),
            confident: true,
        };
    }
    DetectedSite { kind: SiteKind::Static, docroot: ".".into(), confident: false }
}
```

Add `pub mod detect;` to `mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::detect
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): detect php and static sites from a directory listing"
```

---

## Task 10: PHP Dockerfile and dev ini

**Files:**
- Create: `src-tauri/src/modules/services/dockerfile.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`

**Interfaces:**
- Produces: `pub const PHP_TAG: &str`; `pub fn render_php_dockerfile() -> String`; `pub fn render_dev_ini() -> String`.

The ini is load-bearing, not polish. opcache's defaults revalidate on a timer, so without it a saved file can take seconds to appear, and some base images ship production-shaped settings where it never appears at all.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/modules/services/dockerfile.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installs_every_extension_laravel_needs() {
        let out = render_php_dockerfile();
        for ext in ["pdo_mysql", "pdo_pgsql", "mbstring", "bcmath", "intl", "zip", "gd", "redis"] {
            assert!(out.contains(ext), "missing extension {ext}");
        }
    }

    #[test]
    fn ships_composer_and_the_dev_ini() {
        let out = render_php_dockerfile();
        assert!(out.contains("COPY --from=composer:2"));
        assert!(out.contains("terra-dev.ini"));
    }

    #[test]
    fn the_dev_ini_makes_edits_visible_on_the_next_request() {
        let ini = render_dev_ini();
        assert!(ini.contains("opcache.validate_timestamps=1"));
        assert!(ini.contains("opcache.revalidate_freq=0"));
    }

    #[test]
    fn every_image_reference_is_pinned() {
        let out = render_php_dockerfile();
        assert!(!out.contains(":latest"));
        for line in out.lines().filter(|l| l.starts_with("FROM ") || l.contains("--from=")) {
            assert!(line.contains(':'), "unpinned image reference: {line}");
        }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::dockerfile 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function render_php_dockerfile`.

- [ ] **Step 3: Write the minimal implementation**

Prepend to `dockerfile.rs`:

```rust
// Verify against the current PHP release train before shipping, then bump per
// Terra release rather than tracking a floating tag.
pub const PHP_TAG: &str = "8.4-fpm-alpine";
const EXT_INSTALLER: &str = "mlocati/php-extension-installer:2.7.31";
const EXTENSIONS: &str =
    "pdo_mysql pdo_pgsql mbstring bcmath intl zip gd exif pcntl opcache redis";

pub fn render_php_dockerfile() -> String {
    format!(
        "FROM php:{PHP_TAG}\n\
         COPY --from={EXT_INSTALLER} /usr/bin/install-php-extensions /usr/local/bin/\n\
         RUN install-php-extensions {EXTENSIONS}\n\
         COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer\n\
         COPY terra-dev.ini /usr/local/etc/php/conf.d/terra-dev.ini\n\
         WORKDIR /sites\n"
    )
}

pub fn render_dev_ini() -> String {
    "opcache.enable=1\n\
     opcache.validate_timestamps=1\n\
     opcache.revalidate_freq=0\n\
     display_errors=On\n\
     error_reporting=E_ALL\n\
     upload_max_filesize=64M\n\
     post_max_size=64M\n"
        .to_string()
}
```

Add `pub mod dockerfile;` to `mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::dockerfile
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): render the php image with a dev opcache config"
```

---

## Task 11: Vhost rendering and port assignment

**Files:**
- Create: `src-tauri/src/modules/services/vhost.rs`
- Modify: `src-tauri/src/modules/services/mod.rs`

**Interfaces:**
- Consumes: `SiteSpec`, `SiteKind` from Task 3.
- Produces: `pub fn render_vhosts(sites: &[SiteSpec]) -> String`; `pub fn assign_port(taken: &BTreeSet<u16>) -> u16`.

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/modules/services/vhost.rs` with only the test module:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn site(slug: &str, docroot: &str, kind: SiteKind) -> SiteSpec {
        SiteSpec {
            slug: slug.into(),
            root: "/home/u/app".into(),
            docroot: docroot.into(),
            port: 8000,
            kind,
        }
    }

    #[test]
    fn php_root_is_the_mount_joined_with_the_docroot() {
        // The mount is the space root, not the docroot, or Laravel's
        // public/index.php could not reach ../vendor.
        let out = render_vhosts(&[site("app", "public", SiteKind::Php)]);
        assert!(out.contains("root /sites/app/public;"));
        assert!(out.contains("fastcgi_pass php:9000;"));
    }

    #[test]
    fn a_dot_docroot_does_not_produce_a_trailing_dot_path() {
        let out = render_vhosts(&[site("app", ".", SiteKind::Php)]);
        assert!(out.contains("root /sites/app;"));
        assert!(!out.contains("/sites/app/.;"));
    }

    #[test]
    fn static_sites_get_no_php_handler() {
        let out = render_vhosts(&[site("docs", ".", SiteKind::Static)]);
        assert!(!out.contains("fastcgi_pass"));
    }

    #[test]
    fn each_site_gets_exactly_one_server_block() {
        let out = render_vhosts(&[
            site("a", ".", SiteKind::Static),
            site("b", ".", SiteKind::Static),
        ]);
        assert_eq!(out.matches("server {").count(), 2);
    }

    #[test]
    fn assignment_skips_taken_and_catalog_ports() {
        let taken: BTreeSet<u16> = [8000, 8001, 8025].into_iter().collect();
        assert_eq!(assign_port(&taken), 8002);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::vhost 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function render_vhosts`.

- [ ] **Step 3: Write the minimal implementation**

Prepend to `vhost.rs`:

```rust
use std::collections::BTreeSet;
use std::fmt::Write as _;

use super::catalog;
use super::spec::{SiteKind, SiteSpec};

const FIRST_SITE_PORT: u16 = 8000;

pub fn assign_port(taken: &BTreeSet<u16>) -> u16 {
    let reserved: BTreeSet<u16> = catalog::CATALOG
        .iter()
        .flat_map(|d| d.ports.iter().copied())
        .collect();
    (FIRST_SITE_PORT..u16::MAX)
        .find(|p| !taken.contains(p) && !reserved.contains(p))
        .unwrap_or(FIRST_SITE_PORT)
}

fn doc_path(slug: &str, docroot: &str) -> String {
    if docroot == "." {
        format!("/sites/{slug}")
    } else {
        format!("/sites/{slug}/{docroot}")
    }
}

pub fn render_vhosts(sites: &[SiteSpec]) -> String {
    let mut out = String::new();
    for s in sites {
        let root = doc_path(&s.slug, &s.docroot);
        let _ = writeln!(out, "server {{");
        let _ = writeln!(out, "    listen {};", s.port);
        let _ = writeln!(out, "    server_name localhost;");
        let _ = writeln!(out, "    root {root};");
        let _ = writeln!(out, "    index index.php index.html;");
        match s.kind {
            SiteKind::Php => {
                let _ = writeln!(
                    out,
                    "    location / {{ try_files $uri $uri/ /index.php?$query_string; }}"
                );
                let _ = writeln!(out, "    location ~ \\.php$ {{");
                let _ = writeln!(out, "        fastcgi_pass php:9000;");
                let _ = writeln!(out, "        fastcgi_index index.php;");
                let _ = writeln!(out, "        include fastcgi_params;");
                let _ = writeln!(
                    out,
                    "        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;"
                );
                let _ = writeln!(out, "    }}");
            }
            SiteKind::Static => {
                let _ = writeln!(out, "    location / {{ try_files $uri $uri/ =404; }}");
            }
        }
        let _ = writeln!(out, "}}\n");
    }
    out
}
```

Add `pub mod vhost;` to `mod.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::vhost
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): render nginx server blocks and assign site ports"
```

---

## Task 12: Extend the compose renderer for the web tier

**Files:**
- Modify: `src-tauri/src/modules/services/compose.rs`

**Interfaces:**
- Consumes: `RenderEnv.mounts` and `RenderEnv.run_as` from Task 4, `PHP_TAG` from Task 10.
- Produces: the `nginx` and `php` compose services, with identical mount paths.

- [ ] **Step 1: Write the failing test**

Add to the test module in `compose.rs`:

```rust
    fn web_stack() -> (ValidStack, RenderEnv) {
        let stack = validate(StackSpec {
            services: vec![ServiceId::Web],
            ports: Default::default(),
            sites: vec![crate::modules::services::spec::SiteSpec {
                slug: "app".into(),
                root: "/home/u/app".into(),
                docroot: "public".into(),
                port: 8000,
                kind: crate::modules::services::spec::SiteKind::Php,
            }],
            db_password: "sixteencharacters".into(),
        })
        .unwrap();
        let mut mounts = BTreeMap::new();
        mounts.insert("app".to_string(), "/home/u/app".to_string());
        (stack, RenderEnv { run_as: Some((1000, 1000)), mounts })
    }

    #[test]
    fn nginx_and_php_mount_the_same_path() {
        let (stack, env) = web_stack();
        let out = render_compose(&stack, &env);
        // nginx passes SCRIPT_FILENAME as a path php-fpm resolves itself, so a
        // mismatch here becomes a "file not found" that reads like a config bug.
        assert_eq!(out.matches("/home/u/app:/sites/app").count(), 2);
    }

    #[test]
    fn renders_uid_mapping_only_when_asked() {
        let (stack, env) = web_stack();
        assert!(render_compose(&stack, &env).contains("user: \"1000:1000\""));

        let plain_env = RenderEnv { run_as: None, mounts: env.mounts };
        assert!(!render_compose(&stack, &plain_env).contains("user:"));
    }

    #[test]
    fn publishes_each_site_port_on_loopback() {
        let (stack, env) = web_stack();
        assert!(render_compose(&stack, &env).contains("\"127.0.0.1:8000:8000\""));
    }
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::compose 2>&1 | head -30
```

Expected: FAIL, the mount assertion counts 0.

- [ ] **Step 3: Write the minimal implementation**

In `render_compose`, replace the `ServiceId::Web` arm handling. Remove `let _ = env;` and, when `id == ServiceId::Web`, emit both services instead of the generic block:

```rust
        if *id == ServiceId::Web {
            let _ = writeln!(out, "  nginx:");
            let _ = writeln!(out, "    image: {}", d.image);
            let _ = writeln!(out, "    restart: unless-stopped");
            let _ = writeln!(out, "    depends_on:");
            let _ = writeln!(out, "      - php");
            let _ = writeln!(out, "    ports:");
            for site in &stack.sites {
                publish(&mut out, site.port, site.port);
            }
            let _ = writeln!(out, "    volumes:");
            let _ = writeln!(out, "      - ./nginx/conf.d:/etc/nginx/conf.d:ro");
            for (slug, host) in &env.mounts {
                let _ = writeln!(out, "      - {host}:/sites/{slug}");
            }
            out.push('\n');

            let _ = writeln!(out, "  php:");
            let _ = writeln!(out, "    build: ./php");
            let _ = writeln!(out, "    restart: unless-stopped");
            if let Some((uid, gid)) = env.run_as {
                let _ = writeln!(out, "    user: \"{uid}:{gid}\"");
            }
            let _ = writeln!(out, "    volumes:");
            for (slug, host) in &env.mounts {
                let _ = writeln!(out, "      - {host}:/sites/{slug}");
            }
            out.push('\n');
            continue;
        }
```

Place this block at the top of the existing `for id in &stack.services` loop body, before the generic `image:` emission, so `Web` renders two services and every other id falls through to the generic path unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services::compose && cargo clippy --all-targets --locked -- -D warnings
```

Expected: PASS, 8 tests, no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services
git commit -m "feat(services): render nginx and php-fpm with identical mount paths"
```

---

# Phase 5: Web tier wiring

## Task 13: Mount authorization and the sites_detect command

**Files:**
- Modify: `src-tauri/src/modules/services/commands.rs`
- Modify: `src-tauri/src/modules/services/project.rs` (write vhosts, Dockerfile and ini)
- Modify: `src-tauri/src/lib.rs` (register `sites_detect`)

**Interfaces:**
- Consumes: `authorized_read` from `crate::modules::fs`, `WorkspaceRegistry`, `WorkspaceEnv`.
- Produces: `pub fn authorize_mounts(registry, stack) -> Result<BTreeMap<String, String>, String>`; `pub fn run_as_for(runtime, root) -> Option<(u32, u32)>`; `sites_detect(root: String) -> DetectedSite`.

This is the task where the `WorkspaceRegistry` gate enters. The canonical path returned by `authorized_read` must be the exact string written into the YAML.

- [ ] **Step 1: Write the failing test**

Add to the test module in `commands.rs`:

```rust
    use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};
    use crate::modules::services::spec::{SiteKind, SiteSpec};

    fn site_at(root: &std::path::Path, docroot: &str) -> SiteSpec {
        SiteSpec {
            slug: "app".into(),
            root: root.to_string_lossy().into_owned(),
            docroot: docroot.into(),
            port: 8000,
            kind: SiteKind::Php,
        }
    }

    #[test]
    fn an_unauthorized_root_never_reaches_the_yaml() {
        let dir = tempfile::tempdir().unwrap();
        let reg = WorkspaceRegistry::default();
        // No root registered, so the mount must be refused.
        let err = authorize_mounts(&reg, &[site_at(dir.path(), ".")]).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn the_string_checked_is_the_string_emitted() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("public")).unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(dir.path().to_string_lossy().as_ref(), &WorkspaceEnv::Local)
            .unwrap();

        let mounts = authorize_mounts(&reg, &[site_at(dir.path(), "public")]).unwrap();
        let emitted = mounts.get("app").unwrap();
        let canonical = dir.path().canonicalize().unwrap();
        // Byte-identical, or the gap between check and use is a symlink-swap
        // window.
        assert_eq!(emitted, &canonical.to_string_lossy().into_owned());
    }

    #[test]
    fn a_docroot_outside_the_space_root_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let reg = WorkspaceRegistry::default();
        reg.authorize(dir.path().to_string_lossy().as_ref(), &WorkspaceEnv::Local)
            .unwrap();
        // `validate` rejects ".." in a docroot, and this is the second gate:
        // a symlinked docroot that resolves outside must also fail.
        let link = dir.path().join("out");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc", &link).unwrap();
        #[cfg(unix)]
        assert!(authorize_mounts(&reg, &[site_at(dir.path(), "out")]).is_err());
    }
```

Adjust `reg.authorize(...)` to the real `WorkspaceRegistry` API if the signature differs; read `src-tauri/src/modules/workspace.rs` first and use the same call the `fs::authorization_tests` module uses.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd src-tauri && cargo test --locked services::commands 2>&1 | head -20
```

Expected: FAIL to compile, `cannot find function authorize_mounts`.

- [ ] **Step 3: Write the minimal implementation**

Add to `commands.rs`:

```rust
use std::collections::BTreeMap;

use super::detect::{detect_site, DetectedSite};
use super::spec::SiteSpec;
use crate::modules::fs::authorized_read;
use crate::modules::workspace::{WorkspaceEnv, WorkspaceRegistry};

pub fn authorize_mounts(
    registry: &WorkspaceRegistry,
    sites: &[SiteSpec],
) -> Result<BTreeMap<String, String>, String> {
    let mut mounts = BTreeMap::new();
    for site in sites {
        let canonical = authorized_read(registry, &site.root, &WorkspaceEnv::Local)?;

        let docroot = if site.docroot == "." {
            canonical.clone()
        } else {
            canonical.join(&site.docroot)
        };
        let resolved = docroot
            .canonicalize()
            .map_err(|e| format!("{}: {e}", docroot.display()))?;
        if !resolved.starts_with(&canonical) {
            return Err(format!(
                "docroot for {} resolves outside its space root",
                site.slug
            ));
        }

        mounts.insert(site.slug.clone(), canonical.to_string_lossy().into_owned());
    }
    Ok(mounts)
}

/// Docker Desktop and rootless Podman both synthesize ownership, so mapping
/// the host user there breaks writes instead of fixing them. Only rootful
/// Docker on Linux needs it.
pub fn run_as_for(runtime: RuntimeKind, root: &std::path::Path) -> Option<(u32, u32)> {
    #[cfg(target_os = "linux")]
    {
        if runtime == RuntimeKind::Docker {
            use std::os::unix::fs::MetadataExt;
            return std::fs::metadata(root).ok().map(|m| (m.uid(), m.gid()));
        }
        None
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (runtime, root);
        None
    }
}

#[tauri::command]
pub async fn sites_detect(
    root: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<DetectedSite, String> {
    let path = authorized_read(&registry, &root, &WorkspaceEnv::Local)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut files = std::collections::BTreeSet::new();
        let mut dirs = std::collections::BTreeSet::new();
        let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            match entry.file_type() {
                Ok(t) if t.is_dir() => {
                    dirs.insert(name);
                }
                Ok(_) => {
                    files.insert(name);
                }
                Err(_) => {}
            }
        }
        Ok(detect_site(&files, &dirs))
    })
    .await
    .map_err(|e| e.to_string())?
}
```

Update `services_up` to use the real mounts and uid mapping:

```rust
#[tauri::command]
pub async fn services_up(
    spec: StackSpec,
    state: State<'_, ServicesState>,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), String> {
    let stack = validate(spec)?;
    let runtime = resolve_runtime()?;
    preflight(&stack)?;

    let mounts = authorize_mounts(&registry, &stack.sites)?;
    let run_as = stack
        .sites
        .first()
        .and_then(|s| mounts.get(&s.slug))
        .and_then(|p| run_as_for(runtime, std::path::Path::new(p)));

    let env = RenderEnv { run_as, mounts };
    write_project(&stack, &env)?;
    compose(&state, runtime, &["up", "-d", "--build"])?;
    Ok(())
}
```

Extend `write_project` in `project.rs` to also write the vhost config, the Dockerfile and the ini:

```rust
pub fn write_project(stack: &ValidStack, env: &RenderEnv) -> Result<PathBuf, String> {
    let dir = project_dir()?;
    write_compose_to(&dir, &render_compose(stack, env))?;

    let conf_d = dir.join("nginx").join("conf.d");
    std::fs::create_dir_all(&conf_d).map_err(|e| format!("{}: {e}", conf_d.display()))?;
    std::fs::write(conf_d.join("sites.conf"), render_vhosts(&stack.sites))
        .map_err(|e| e.to_string())?;

    let php = dir.join("php");
    std::fs::create_dir_all(&php).map_err(|e| format!("{}: {e}", php.display()))?;
    std::fs::write(php.join("Dockerfile"), render_php_dockerfile())
        .map_err(|e| e.to_string())?;
    std::fs::write(php.join("terra-dev.ini"), render_dev_ini())
        .map_err(|e| e.to_string())?;

    Ok(dir)
}
```

Register `services::commands::sites_detect` in `lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd src-tauri && cargo test --locked services:: && cargo clippy --all-targets --locked -- -D warnings
```

Expected: PASS, no warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/modules/services src-tauri/src/lib.rs
git commit -m "feat(services): authorize site mounts through the workspace registry"
```

---

## Task 14: Sites table

**Files:**
- Create: `src/modules/services/SitesTable.tsx`
- Create: `src/modules/services/lib/sites.ts`
- Create: `src/modules/services/lib/sites.test.ts`
- Modify: `src/modules/services/index.ts`, `src/settings/sections/ServicesSection.tsx`

**Interfaces:**
- Consumes: `sites_detect`, `useSpaces` from `@/modules/spaces`, `newPreviewTab` behaviour via the existing preview tab.
- Produces: `slugFromName(name: string): string`; `nextSitePort(taken: number[]): number`; `<SitesTable />`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/services/lib/sites.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextSitePort, slugFromName } from "@/modules/services/lib/sites";

describe("slugFromName", () => {
  it("produces a safe DNS-style label", () => {
    expect(slugFromName("My App")).toBe("my-app");
    expect(slugFromName("../evil")).toBe("evil");
    expect(slugFromName("a/b")).toBe("a-b");
    expect(slugFromName("--Lead--")).toBe("lead");
  });

  it("truncates to the 63 character label limit", () => {
    expect(slugFromName("x".repeat(200))).toHaveLength(63);
  });

  it("returns an empty string when nothing usable survives", () => {
    expect(slugFromName("///")).toBe("");
  });
});

describe("nextSitePort", () => {
  it("starts at 8000 and skips taken and reserved ports", () => {
    expect(nextSitePort([])).toBe(8000);
    expect(nextSitePort([8000, 8001])).toBe(8002);
    expect(nextSitePort([8000, 8001, 8002, 8003, 8004])).toBe(8005);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test src/modules/services/lib/sites.test.ts
```

Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/services/lib/sites.ts`:

```ts
const RESERVED = new Set([1025, 3306, 5432, 6379, 8025, 8026]);

export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

export function nextSitePort(taken: number[]): number {
  const used = new Set(taken);
  let port = 8000;
  while (used.has(port) || RESERVED.has(port)) port++;
  return port;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test src/modules/services/lib/sites.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Build the table**

Create `src/modules/services/SitesTable.tsx` against this contract:

```tsx
export type SiteRow = {
  slug: string;
  spaceName: string;
  root: string;
  docroot: string;
  port: number;
  kind: "php" | "static";
  /** false when detect_site fell through to its guess branch */
  confident: boolean;
  /** Windows only: root is on C: rather than inside WSL */
  slowMount: boolean;
};

export function SitesTable({
  rows,
  webHealthy,
  onDocrootChange,
  onOpen,
}: {
  rows: SiteRow[];
  webHealthy: boolean;
  onDocrootChange: (slug: string, docroot: string) => void;
  onOpen: (url: string) => void;
}): JSX.Element;
```

Render one row per Terra space: the space name, the assigned `http://localhost:<port>` URL, a badge reading `PHP`, `Static`, or `Static (guess)` when `confident` is false, an editable docroot `Input`, and an Open `Button`.

Open must be `disabled={!webHealthy}` with a `Tooltip` explaining the stack is not running, since the spec requires never opening a preview tab onto a connection refused. When enabled, `onOpen` routes to the existing preview tab via `newPreviewTab(url)` in `src/modules/tabs/lib/useTabs.ts:557`.

When `slowMount` is true, render a warning that bind mounts through `/mnt/c` are slow for PHP's many-small-file access and that a WSL space avoids it.

On Windows, when a site root is not a WSL path, render a "slow mount" warning: bind mounts through `/mnt/c` are slow for PHP's many-small-file access, and a WSL space avoids it.

Wire the table into `ServicesSection` below the service rows, shown only when the runtime is ready.

- [ ] **Step 6: Verify**

```bash
pnpm lint && pnpm check-types && pnpm test && pnpm knip
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo nextest run --locked
```

- [ ] **Step 7: Manual verification of the whole loop**

```bash
pnpm tauri dev
```

Open a Laravel project as a space, enable Web and MariaDB, wait for the first PHP build, press Open, then edit a `.php` file and reload the preview tab. The change must appear on the next request with no container restart. On Linux, confirm ownership:

```bash
docker compose -p terra exec php composer install
ls -l vendor | head -3
```

Expected: files owned by your user, not root.

- [ ] **Step 8: Commit**

```bash
git add src/modules/services src/settings
git commit -m "feat(services): add the sites table with detection and preview open"
```

---

# Phase 6: Statusbar integration

## Task 15: Statusbar pill

**Files:**
- Create: `src/modules/services/ServicesPill.tsx`
- Create: `src/modules/services/lib/pillGate.ts`
- Create: `src/modules/services/lib/pillGate.test.ts`
- Modify: `src/modules/statusbar/` (mount the pill next to the existing indicators)
- Modify: `src/modules/services/index.ts`

**Interfaces:**
- Consumes: `services` config from the settings store, `services_status`.
- Produces: `shouldMountPill(config): boolean`; `<ServicesPill />`.

The gate is the whole point: it must read one boolean from the settings store and mount nothing else when services were never enabled, so the eager cost stays under 2 kB.

- [ ] **Step 1: Write the failing test**

Create `src/modules/services/lib/pillGate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldMountPill } from "@/modules/services/lib/pillGate";

describe("shouldMountPill", () => {
  it("stays out of the way until services are enabled", () => {
    expect(shouldMountPill({ services: [] })).toBe(false);
    expect(shouldMountPill(undefined)).toBe(false);
  });

  it("mounts once any service is enabled", () => {
    expect(shouldMountPill({ services: ["mariadb"] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test src/modules/services/lib/pillGate.test.ts
```

Expected: FAIL, cannot resolve the module.

- [ ] **Step 3: Write the minimal implementation**

Create `src/modules/services/lib/pillGate.ts`:

```ts
/** Kept dependency-free and tiny: this is the only services code allowed in
 * the eager bundle. Everything it gates is lazily imported. */
export function shouldMountPill(
  config: { services: string[] } | undefined,
): boolean {
  return (config?.services.length ?? 0) > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm test src/modules/services/lib/pillGate.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Build and mount the pill**

Create `src/modules/services/ServicesPill.tsx`:

```tsx
export function ServicesPill(): JSX.Element | null;
```

It polls `services_status` only while the app window is focused, shows a dot plus the count of healthy services, and calls `openSettingsWindow("services")` on click, which deep-links via the `tab` argument already supported by `open_settings_window` in `src-tauri/src/lib.rs:96`.

Mount it in the statusbar like this, so the eager graph carries the gate and nothing else:

```tsx
const ServicesPill = lazy(() =>
  import("@/modules/services/ServicesPill").then((m) => ({
    default: m.ServicesPill,
  })),
);

// in the statusbar render:
{shouldMountPill(prefs.services) && (
  <Suspense fallback={null}>
    <ServicesPill />
  </Suspense>
)}
```

- [ ] **Step 6: Verify the eager budget**

```bash
pnpm test src/app/eager-budget.test.ts && pnpm test src/app/eager-size.test.ts
pnpm lint && pnpm check-types && pnpm knip
```

Expected: PASS. If `eager-size.test.ts` fails, the pill or its gate pulled something heavy into the startup graph; move it behind the lazy boundary.

- [ ] **Step 7: Full check suite**

```bash
pnpm lint && pnpm check-types && pnpm test && pnpm knip && pnpm audit --prod
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings && cargo nextest run --locked && cargo audit
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/services src/modules/statusbar
git commit -m "feat(services): add a statusbar pill gated on enabled services"
```

---

## Post-implementation checklist

- [ ] Update `TERRA.md`: add `services/` to the Rust module list under the two-process model, add `src/modules/services/` to the frontend module layout, and note that the Services tab exists.
- [ ] Confirm every pinned tag in `catalog.rs` and `PHP_TAG` in `dockerfile.rs` matches a current upstream release. The spec requires verifying these at implementation time rather than trusting the values written here.
- [ ] Verify the feature end to end on both Docker and rootless Podman, which is an explicit success criterion.
