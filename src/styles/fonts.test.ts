import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_FONT_FAMILY,
  BUNDLED_FONTS,
  primaryFamily,
  TERMINAL_FONT_FAMILY,
} from "@/lib/fonts";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, "fonts.css"), "utf8");

type Face = { family: string; weight: string; style: string; url: string };

function faces(): Face[] {
  return css
    .split("@font-face")
    .slice(1)
    .map((block) => ({
      family: /font-family:\s*"([^"]+)"/.exec(block)?.[1] ?? "",
      weight: /font-weight:\s*(\d+)/.exec(block)?.[1] ?? "",
      style: /font-style:\s*(\w+)/.exec(block)?.[1] ?? "",
      url: /url\("([^"]+)"\)/.exec(block)?.[1] ?? "",
    }));
}

const expected = new Set([
  primaryFamily(APP_FONT_FAMILY),
  primaryFamily(TERMINAL_FONT_FAMILY),
  ...BUNDLED_FONTS.map((f) => f.family),
]);

describe("bundled fonts", () => {
  it("declares a regular and a bold face for every family the app names", () => {
    for (const family of expected) {
      const own = faces().filter((f) => f.family === family);
      expect(own.map((f) => `${f.weight} ${f.style}`)).toEqual(
        expect.arrayContaining(["400 normal", "700 normal"]),
      );
    }
  });

  it("declares no family the registry does not know", () => {
    const declared = new Set(faces().map((f) => f.family));
    expect([...declared].sort()).toEqual([...expected].sort());
  });

  it("points every face at a woff2 file that ships in the tree", () => {
    for (const face of faces()) {
      expect(face.url).toMatch(/\.woff2$/);
      expect(existsSync(path.resolve(here, face.url))).toBe(true);
    }
  });

  it("sits next to a license for each bundled family", () => {
    for (const font of BUNDLED_FONTS) {
      expect(
        existsSync(path.join(here, "../assets/fonts", font.id, "LICENSE")),
      ).toBe(true);
    }
  });
});
