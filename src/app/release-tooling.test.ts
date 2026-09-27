import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderChangelog } from "../../scripts/changelog.mjs";
import {
  bumpVersions,
  checkVersions,
  readVersions,
} from "../../scripts/version.mjs";

const root = join(__dirname, "..", "..");

function realTexts(): Record<string, string> {
  return Object.fromEntries(
    [
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
    ].map((f) => [f, readFileSync(join(root, f), "utf8")]),
  );
}

// A lock where another crate shares terra's version: only terra may move.
const LOCK = `[[package]]
name = "tempfile"
version = "0.9.4"

[[package]]
name = "terra"
version = "0.9.4"
dependencies = [
 "tempfile",
]
`;

const TOML = `[package]
name = "terra"
version = "0.9.4"

[dependencies]
serde = { version = "1" }

[build-dependencies]
tauri-build = { version = "2" }
`;

const PKG = `{
  "name": "terra",
  "version": "0.9.4",
  "dependencies": { "x": "1.0.0" }
}
`;

const CONF = `{
  "productName": "Terra",
  "version": "0.9.4",
  "plugins": { "updater": { "version": "ignored" } }
}
`;

const fixture = () => ({
  "package.json": PKG,
  "src-tauri/tauri.conf.json": CONF,
  "src-tauri/Cargo.toml": TOML,
  "src-tauri/Cargo.lock": LOCK,
});

describe("version:check", () => {
  it("the committed tree agrees with itself", () => {
    expect(checkVersions(readVersions(realTexts()))).toEqual([]);
  });

  it("fails when one file drifts", () => {
    const texts = fixture();
    texts["src-tauri/Cargo.toml"] = TOML.replace(
      'version = "0.9.4"',
      'version = "0.9.5"',
    );
    expect(checkVersions(readVersions(texts))).toEqual([
      "src-tauri/Cargo.toml is 0.9.5, expected 0.9.4",
    ]);
  });

  it("fails when the tag differs, with or without the v or ref prefix", () => {
    const v = readVersions(fixture());
    expect(checkVersions(v, "v0.9.4")).toEqual([]);
    expect(checkVersions(v, "refs/tags/v0.9.4")).toEqual([]);
    expect(checkVersions(v, "0.9.4")).toEqual([]);
    expect(checkVersions(v, "v0.9.40")).toHaveLength(1);
    expect(checkVersions(v, "v0.9.3")).toHaveLength(1);
  });

  it("refuses to read a file it cannot locate the version in", () => {
    const texts = fixture();
    texts["src-tauri/Cargo.lock"] = LOCK.replace(
      'name = "terra"',
      'name = "x"',
    );
    expect(() => readVersions(texts)).toThrow(/terra entry/);
  });
});

describe("version:bump", () => {
  it("moves exactly the four app versions and nothing else", () => {
    const out = bumpVersions(fixture(), "1.0.0");
    expect(checkVersions(readVersions(out), "v1.0.0")).toEqual([]);
    expect(out["src-tauri/Cargo.lock"]).toContain(
      'name = "tempfile"\nversion = "0.9.4"',
    );
    expect(out["src-tauri/Cargo.toml"]).toContain('serde = { version = "1" }');
    expect(out["src-tauri/tauri.conf.json"]).toContain('"version": "ignored"');
    expect(out["package.json"]).toBe(PKG.replace("0.9.4", "1.0.0"));
  });

  it("rejects a version that is not semver", () => {
    for (const bad of ["1.0", "v1.0.0", "1.0.0$&", "", "latest"]) {
      expect(() => bumpVersions(fixture(), bad)).toThrow(/semver/);
    }
  });
});

describe("changelog", () => {
  it("groups conventional commits and skips merges and releases", () => {
    const md = renderChangelog("1.0.0", "2026-01-01", [
      { hash: "a".repeat(40), subject: "feat(tabs): colour tabs" },
      { hash: "b".repeat(40), subject: "fix: stop a crash" },
      { hash: "c".repeat(40), subject: "Merge branch 'x'" },
      { hash: "d".repeat(40), subject: "release: v0.9.4" },
      { hash: "e".repeat(40), subject: "feat(api)!: drop v1" },
      { hash: "f".repeat(40), subject: "tidy things up" },
    ]);
    expect(md).toBe(
      [
        "## v1.0.0 (2026-01-01)",
        "",
        "### Features",
        "",
        "- **tabs**: colour tabs (aaaaaaa)",
        "- **api**: drop v1 (breaking) (eeeeeee)",
        "",
        "### Fixes",
        "",
        "- stop a crash (bbbbbbb)",
        "",
        "### Other",
        "",
        "- tidy things up (fffffff)",
        "",
      ].join("\n"),
    );
  });
});
