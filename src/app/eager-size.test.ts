import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureEager } from "../../scripts/eager-size.mjs";

let dir: string;

function html(entry: string, preloads: string[]): string {
  const links = preloads
    .map((p) => `<link rel="modulepreload" crossorigin href="/${p}">`)
    .join("\n");
  return `<!doctype html><html><head>${links}</head><body><script type="module" crossorigin src="/${entry}"></script></body></html>`;
}

function chunk(name: string, bytes: number): void {
  writeFileSync(join(dir, name), "x".repeat(bytes));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eager-size-"));
  mkdirSync(join(dir, "assets"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("measureEager", () => {
  it("counts the entry script plus every modulepreload", () => {
    chunk("assets/main.js", 5000);
    chunk("assets/react.js", 3000);
    writeFileSync(
      join(dir, "index.html"),
      html("assets/main.js", ["assets/react.js"]),
    );

    const [report] = measureEager(dir);

    expect(report.entry).toBe("index.html");
    expect(report.chunks.map((c) => c.file)).toEqual([
      "assets/main.js",
      "assets/react.js",
    ]);
    expect(report.totalGzip).toBe(
      report.chunks[0].gzip + report.chunks[1].gzip,
    );
  });

  it("sorts chunks by gzipped size descending", () => {
    chunk("assets/small.js", 100);
    chunk("assets/big.js", 90000);
    writeFileSync(
      join(dir, "index.html"),
      html("assets/small.js", ["assets/big.js"]),
    );

    const [report] = measureEager(dir);

    expect(report.chunks[0].file).toBe("assets/big.js");
  });

  it("counts a chunk once when the entry also preloads it", () => {
    chunk("assets/main.js", 4000);
    writeFileSync(
      join(dir, "index.html"),
      html("assets/main.js", ["assets/main.js"]),
    );

    const [report] = measureEager(dir);

    expect(report.chunks).toHaveLength(1);
  });

  it("reports every html entry in the dist directory", () => {
    chunk("assets/main.js", 1000);
    chunk("assets/settings.js", 800);
    writeFileSync(join(dir, "index.html"), html("assets/main.js", []));
    writeFileSync(join(dir, "settings.html"), html("assets/settings.js", []));

    const entries = measureEager(dir).map((r) => r.entry);

    expect(entries).toEqual(["index.html", "settings.html"]);
  });

  it("ignores non-module scripts and stylesheet links", () => {
    chunk("assets/main.js", 2000);
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html><html><head>` +
        `<link rel="stylesheet" href="/assets/main.css">` +
        `</head><body><script>var inline = 1;</script>` +
        `<script type="module" crossorigin src="/assets/main.js"></script>` +
        `</body></html>`,
    );

    const [report] = measureEager(dir);

    expect(report.chunks.map((c) => c.file)).toEqual(["assets/main.js"]);
  });

  it("throws naming the chunk when a referenced file is missing", () => {
    writeFileSync(join(dir, "index.html"), html("assets/gone.js", []));

    expect(() => measureEager(dir)).toThrow(/assets\/gone\.js/);
  });

  it("throws when the dist directory has no html entry", () => {
    expect(() => measureEager(dir)).toThrow(/no html entr/i);
  });
});
