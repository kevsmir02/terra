import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { renderTokenReference } from "./theme-token-reference.mjs";

// TOKENS is TypeScript, so it is loaded through Vite's SSR loader rather than
// a second toolchain. Everything between the first start marker and the last
// end marker in THEME.md is replaced by the generated block.
const START = "<!-- token-reference:start -->";
const END = "<!-- token-reference:end -->";

const server = await createServer({
  configFile: "vite.config.ts",
  server: { middlewareMode: true },
  logLevel: "silent",
});
try {
  const { TOKENS } = await server.ssrLoadModule("/src/modules/theme/tokens.ts");
  const block = renderTokenReference(TOKENS);
  const doc = readFileSync("THEME.md", "utf8");
  const start = doc.indexOf(START);
  const end = doc.lastIndexOf(END);
  if (start === -1 || end === -1) {
    throw new Error("THEME.md is missing the token-reference markers");
  }
  writeFileSync("THEME.md", doc.slice(0, start) + block + doc.slice(end + END.length));
  console.log(`THEME.md token reference synced (${TOKENS.length} tokens)`);
} finally {
  await server.close();
}
