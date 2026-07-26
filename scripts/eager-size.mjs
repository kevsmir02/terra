#!/usr/bin/env node
// Measures each window's true startup cost: the entry module script plus every
// <link rel="modulepreload"> the build emits into that window's HTML. That set
// is by definition what the browser fetches before interaction, so it stays
// correct across any manualChunks change - unlike the hand-maintained,
// hash-suffixed globs it replaces, which silently under-reported by 43%.
//
// CLI:  node scripts/eager-size.mjs [distDir]
// Used as a library by src/app/eager-size.test.ts.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// `href`/`src` may appear before or after other attributes, so match the tag
// first and pull the URL out of it rather than assuming attribute order.
const PRELOAD_TAG = /<link\b[^>]*\brel="modulepreload"[^>]*>/gi;
const MODULE_SCRIPT_TAG = /<script\b[^>]*\btype="module"[^>]*>/gi;
const URL_ATTR = /\b(?:href|src)="([^"]+)"/i;

function urlsFrom(html, tagRe) {
  const out = [];
  for (const [tag] of html.matchAll(tagRe)) {
    const m = tag.match(URL_ATTR);
    if (m) out.push(m[1]);
  }
  return out;
}

/** Strip the leading slash Vite emits so the path joins onto distDir. */
function toRelative(url) {
  return url.replace(/^\.?\//, "");
}

/**
 * @param {string} distDir
 * @returns {{entry: string, chunks: {file: string, gzip: number}[], totalGzip: number}[]}
 */
export function measureEager(distDir) {
  const dist = resolve(root, distDir);
  const entries = readdirSync(dist)
    .filter((f) => f.endsWith(".html"))
    .sort();
  if (entries.length === 0) {
    throw new Error(`eager-size: no html entries found in ${dist}`);
  }

  return entries.map((entry) => {
    const html = readFileSync(join(dist, entry), "utf8");
    const urls = [
      ...urlsFrom(html, MODULE_SCRIPT_TAG),
      ...urlsFrom(html, PRELOAD_TAG),
    ]
      .map(toRelative)
      .filter((f) => f.endsWith(".js"));

    const seen = new Set();
    const chunks = [];
    for (const file of urls) {
      if (seen.has(file)) continue;
      seen.add(file);
      const abs = join(dist, file);
      // Reporting a smaller total on a missing file would reproduce exactly the
      // under-measurement this script exists to prevent.
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        throw new Error(`eager-size: ${entry} references missing chunk ${file}`);
      }
      chunks.push({ file, gzip: gzipSync(readFileSync(abs)).length });
    }
    chunks.sort((a, b) => b.gzip - a.gzip);

    return {
      entry,
      chunks,
      totalGzip: chunks.reduce((sum, c) => sum + c.gzip, 0),
    };
  });
}

/** @returns {Record<string, number>} entry html name -> budget in gzipped kB */
export function readBudgets(rootDir = root) {
  return JSON.parse(readFileSync(join(rootDir, "eager-budget.json"), "utf8"));
}

const KB = 1024;

const isCli = process.argv[1] === fileURLToPath(import.meta.url);
if (isCli) {
  const reports = measureEager(process.argv[2] || "dist");
  const budgets = readBudgets();
  let failed = false;

  for (const { entry, chunks, totalGzip } of reports) {
    const budget = budgets[entry];
    console.log(`\n${entry} - eager startup chunks`);
    for (const c of chunks) {
      console.log(`  ${String((c.gzip / KB).toFixed(1)).padStart(8)} kB  ${c.file}`);
    }
    const total = totalGzip / KB;
    // A new window entry with no budget must fail, not silently escape the gate.
    if (budget === undefined) {
      console.error(`  MISSING BUDGET for ${entry} - add it to eager-budget.json`);
      failed = true;
      continue;
    }
    const verdict = total > budget ? "OVER BUDGET" : "ok";
    console.log(
      `  ---\n  ${total.toFixed(1)} kB gzipped across ${chunks.length} chunks (budget ${budget} kB) ${verdict}`,
    );
    if (total > budget) failed = true;
  }

  console.log("");
  process.exit(failed ? 1 : 0);
}
