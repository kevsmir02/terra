import { describe, expect, it } from "vitest";
import { hasMermaidFence } from "./mermaidFence";

describe("hasMermaidFence", () => {
  it("matches a backtick or tilde fence with the mermaid info string", () => {
    expect(hasMermaidFence("# Doc\n\n```mermaid\ngraph TD\n```\n")).toBe(true);
    expect(hasMermaidFence("~~~mermaid\ngraph TD\n~~~")).toBe(true);
    expect(hasMermaidFence("````  Mermaid title\n````")).toBe(true);
    expect(hasMermaidFence("   ```mermaid\n```")).toBe(true);
  });

  it("ignores a fence indented into a code block or with another language", () => {
    expect(hasMermaidFence("    ```mermaid\n    ```")).toBe(false);
    expect(hasMermaidFence("```mermaidjs\n```")).toBe(false);
    expect(hasMermaidFence("```js\nconst mermaid = 1;\n```")).toBe(false);
  });

  it("ignores inline code and prose mentioning mermaid", () => {
    expect(hasMermaidFence("Use `mermaid` for diagrams.")).toBe(false);
    expect(hasMermaidFence("The mermaid swam.")).toBe(false);
    expect(hasMermaidFence("")).toBe(false);
  });
});
