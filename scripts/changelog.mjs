#!/usr/bin/env node
// Changelog section from the conventional commits since the previous tag.
// Merges and release commits are skipped; anything that is not a
// conventional subject lands under "Other" rather than being dropped.
//
// CLI:  node scripts/changelog.mjs [from-ref] [to-ref]
//       from-ref defaults to the newest tag before to-ref (default HEAD).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SECTIONS = [
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactors"],
  ["docs", "Documentation"],
  ["test", "Tests"],
  ["build", "Build"],
  ["ci", "CI"],
  ["chore", "Chores"],
];

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;

/** @returns {{type: string, scope: string | null, breaking: boolean, summary: string} | null} */
export function parseSubject(subject) {
  const m = subject.match(CONVENTIONAL);
  if (!m) return null;
  return {
    type: m[1].toLowerCase(),
    scope: m[2] ?? null,
    breaking: m[3] === "!",
    summary: m[4].trim(),
  };
}

function skipped(subject) {
  return /^Merge (branch|pull request|remote-tracking branch) /.test(subject) ||
    /^release: /.test(subject);
}

/**
 * @param {string} version
 * @param {string} date YYYY-MM-DD
 * @param {{hash: string, subject: string}[]} commits newest first
 */
export function renderChangelog(version, date, commits) {
  const groups = new Map();
  for (const c of commits) {
    if (skipped(c.subject)) continue;
    const parsed = parseSubject(c.subject);
    const known = parsed && SECTIONS.some(([t]) => t === parsed.type);
    const key = known ? parsed.type : "other";
    const text = parsed && known
      ? `${parsed.scope ? `**${parsed.scope}**: ` : ""}${parsed.summary}${parsed.breaking ? " (breaking)" : ""}`
      : c.subject;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`- ${text} (${c.hash.slice(0, 7)})`);
  }
  const lines = [`## v${version} (${date})`, ""];
  for (const [type, title] of [...SECTIONS, ["other", "Other"]]) {
    const items = groups.get(type);
    if (!items) continue;
    lines.push(`### ${title}`, "", ...items, "");
  }
  if (groups.size === 0) lines.push("No changes.", "");
  return lines.join("\n");
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function previousTag(to) {
  const tagged = git(["tag", "--points-at", to]).split("\n").filter(Boolean);
  const base = tagged.length > 0 ? `${to}^` : to;
  try {
    return git(["describe", "--tags", "--abbrev=0", base]);
  } catch {
    return null;
  }
}

function main([fromArg, toArg]) {
  const to = toArg ?? "HEAD";
  const from = fromArg ?? previousTag(to);
  const range = from ? `${from}..${to}` : to;
  const out = git(["log", "--no-merges", "--format=%H%x09%s", range]);
  const commits = out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      return { hash, subject: rest.join("\t") };
    });
  const version = /^v\d/.test(to)
    ? to.slice(1)
    : JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const date = git(["log", "-1", "--format=%cs", to]);
  process.stdout.write(renderChangelog(version, date, commits));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
