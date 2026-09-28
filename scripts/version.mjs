#!/usr/bin/env node
// The app version lives in four files that must agree with each other and
// with the release tag. `bump` rewrites all four in place, keeping their
// formatting; `check` fails when any disagree or differ from the tag.
//
// CLI:  node scripts/version.mjs bump <x.y.z>
//       node scripts/version.mjs check [tag]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isSemver(v) {
  return typeof v === "string" && SEMVER.test(v);
}

// Top-level "version" of a JSON document: the first key match must be the one
// JSON.parse sees, or the file is shaped in a way this edit cannot trust.
function jsonVersion(text, file) {
  const parsed = JSON.parse(text).version;
  const m = text.match(/^(\s*"version"\s*:\s*")([^"]*)(")/m);
  if (!m || m[2] !== parsed) {
    throw new Error(`${file}: cannot locate the top-level "version"`);
  }
  return { value: parsed, match: m };
}

function setJsonVersion(text, version, file) {
  const { match } = jsonVersion(text, file);
  const out = text.replace(match[0], () => `${match[1]}${version}${match[3]}`);
  if (JSON.parse(out).version !== version) {
    throw new Error(`${file}: version rewrite did not land`);
  }
  return out;
}

const CARGO_PACKAGE = /(^\[package\]\s*\n(?:(?!^\[)[^\n]*\n)*?^version\s*=\s*")([^"]*)(")/m;
const LOCK_ENTRY = /(^\[\[package\]\]\nname = "terra"\nversion = ")([^"]*)(")/m;

function tomlVersion(re, file, what) {
  const find = (text) => {
    const m = text.match(re);
    if (!m) throw new Error(`${file}: cannot locate ${what}`);
    return m;
  };
  return {
    read: (text) => find(text)[2],
    // A callback, so a `$` in the version cannot act as a replacement pattern.
    write: (text, v) => {
      find(text);
      return text.replace(re, (_, head, _old, tail) => `${head}${v}${tail}`);
    },
  };
}

export const FILES = {
  "package.json": {
    read: (t) => jsonVersion(t, "package.json").value,
    write: (t, v) => setJsonVersion(t, v, "package.json"),
  },
  "src-tauri/tauri.conf.json": {
    read: (t) => jsonVersion(t, "tauri.conf.json").value,
    write: (t, v) => setJsonVersion(t, v, "tauri.conf.json"),
  },
  "src-tauri/Cargo.toml": tomlVersion(
    CARGO_PACKAGE,
    "Cargo.toml",
    "the [package] version",
  ),
  "src-tauri/Cargo.lock": tomlVersion(LOCK_ENTRY, "Cargo.lock", "the terra entry"),
};

/** @param {Record<string, string>} texts file -> contents */
export function readVersions(texts) {
  return Object.fromEntries(
    Object.entries(FILES).map(([file, spec]) => [file, spec.read(texts[file])]),
  );
}

/** @returns {string[]} one line per problem, empty when consistent */
export function checkVersions(versions, tag) {
  const problems = [];
  const values = Object.values(versions);
  const first = values[0];
  if (!isSemver(first)) problems.push(`not a semver version: ${first}`);
  for (const [file, v] of Object.entries(versions)) {
    if (v !== first) problems.push(`${file} is ${v}, expected ${first}`);
  }
  if (tag !== undefined && tag !== "") {
    const fromTag = tag.replace(/^refs\/tags\//, "").replace(/^v/, "");
    if (fromTag !== first) {
      problems.push(`tag ${tag} does not match version ${first}`);
    }
  }
  return problems;
}

/** @param {Record<string, string>} texts file -> contents */
export function bumpVersions(texts, version) {
  if (!isSemver(version)) throw new Error(`not a semver version: ${version}`);
  return Object.fromEntries(
    Object.entries(FILES).map(([file, spec]) => [
      file,
      spec.write(texts[file], version),
    ]),
  );
}

function readAll(dir) {
  return Object.fromEntries(
    Object.keys(FILES).map((f) => [f, readFileSync(join(dir, f), "utf8")]),
  );
}

function main([cmd, arg]) {
  const texts = readAll(root);
  if (cmd === "bump") {
    const next = bumpVersions(texts, arg);
    for (const [file, text] of Object.entries(next)) {
      writeFileSync(join(root, file), text);
    }
    console.log(`version set to ${arg} in ${Object.keys(next).join(", ")}`);
    return 0;
  }
  if (cmd === "check") {
    const versions = readVersions(texts);
    const problems = checkVersions(versions, arg);
    if (problems.length > 0) {
      for (const p of problems) console.error(`version:check: ${p}`);
      return 1;
    }
    const v = Object.values(versions)[0];
    console.log(`version ${v} consistent${arg ? ` with tag ${arg}` : ""}`);
    return 0;
  }
  console.error("usage: version.mjs bump <x.y.z> | check [tag]");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`version: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  }
}
