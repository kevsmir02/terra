import { expect, it } from "vitest";
import { ALL_VARS } from "./applyTheme";
import { TOKENS } from "./tokens";

it("clears exactly the variables the registry declares", () => {
  expect([...ALL_VARS].sort()).toEqual(TOKENS.map((t) => t.cssVar).sort());
});
