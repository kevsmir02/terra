import { describe, expect, it } from "vitest";
import { type DragHit, planDrop } from "./dropPlan";

const root = "/ws";
const isDir = (p: string) => p === "/ws/src" || p === "/ws/docs";
const hit = (partial: Partial<DragHit>): DragHit => ({
  fsPath: null,
  insideExplorer: false,
  paneLeafId: null,
  ...partial,
});

describe("planDrop", () => {
  it("pastes into the terminal leaf under the cursor", () => {
    expect(planDrop(hit({ paneLeafId: 7 }), "/ws/src/a.ts", root, isDir)).toEqual(
      { kind: "terminal", leafId: 7 },
    );
  });

  it("does nothing when released outside the explorer and off any terminal", () => {
    expect(planDrop(hit({}), "/ws/src/a.ts", root, isDir)).toEqual({
      kind: "none",
    });
  });

  it("moves to the root when released on the explorer's blank area", () => {
    expect(
      planDrop(hit({ insideExplorer: true }), "/ws/src/a.ts", root, isDir),
    ).toEqual({ kind: "move", toDir: "/ws" });
  });

  it("moves into a folder row, or into a file row's folder", () => {
    expect(
      planDrop(
        hit({ insideExplorer: true, fsPath: "/ws/docs" }),
        "/ws/src/a.ts",
        root,
        isDir,
      ),
    ).toEqual({ kind: "move", toDir: "/ws/docs" });
    expect(
      planDrop(
        hit({ insideExplorer: true, fsPath: "/ws/docs/readme.md" }),
        "/ws/src/a.ts",
        root,
        isDir,
      ),
    ).toEqual({ kind: "move", toDir: "/ws/docs" });
  });

  it("refuses a move onto itself, into itself, or back into its own folder", () => {
    expect(
      planDrop(
        hit({ insideExplorer: true, fsPath: "/ws/src" }),
        "/ws/src",
        root,
        isDir,
      ),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(
        hit({ insideExplorer: true, fsPath: "/ws/src/a.ts" }),
        "/ws/src",
        root,
        isDir,
      ),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(
        hit({ insideExplorer: true, fsPath: "/ws/src/b.ts" }),
        "/ws/src/a.ts",
        root,
        isDir,
      ),
    ).toEqual({ kind: "none" });
    expect(
      planDrop(hit({ insideExplorer: true }), "/ws/a.ts", root, isDir),
    ).toEqual({ kind: "none" });
  });
});
