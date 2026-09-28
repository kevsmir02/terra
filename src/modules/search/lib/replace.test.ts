import {
  editKey,
  type Edit,
  type FilePreview,
  fileCheck,
  flagForKey,
  parseGlobList,
  planApply,
  type ReplacePreview,
  summarizeApply,
  toggleEdit,
  toggleFile,
} from "@/modules/search/lib/replace";
import { describe, expect, it } from "vitest";

function edit(start: number, replacement = "new"): Edit {
  return {
    start,
    end: start + 3,
    line: 1,
    before: "",
    matched: "old",
    after: "",
    replacement,
  };
}

function file(path: string, starts: number[]): FilePreview {
  return {
    path,
    rel: path.slice(1),
    hash: `h:${path}`,
    edits: starts.map((s) => edit(s)),
  };
}

function preview(files: FilePreview[]): ReplacePreview {
  return {
    files,
    totalMatches: files.reduce((n, f) => n + f.edits.length, 0),
    filesScanned: files.length,
    truncated: false,
    skipped: [],
    skippedLarge: 0,
  };
}

describe("planApply", () => {
  it("sends every included match with the hash the preview was computed on", () => {
    const p = preview([file("/a", [0, 10]), file("/b", [4])]);
    const plan = planApply(p, new Set(), new Set());
    expect(plan.replacements).toBe(3);
    expect(plan.files).toEqual([
      {
        path: "/a",
        hash: "h:/a",
        edits: [
          { start: 0, end: 3, replacement: "new" },
          { start: 10, end: 13, replacement: "new" },
        ],
      },
      {
        path: "/b",
        hash: "h:/b",
        edits: [{ start: 4, end: 7, replacement: "new" }],
      },
    ]);
  });

  it("drops excluded matches and files with nothing left", () => {
    const a = file("/a", [0, 10]);
    const b = file("/b", [4]);
    let excluded = toggleEdit("/a", a.edits[0], new Set());
    excluded = toggleFile(b, excluded);
    const plan = planApply(preview([a, b]), excluded, new Set());
    expect(plan.files.map((f) => f.path)).toEqual(["/a"]);
    expect(plan.files[0].edits.map((e) => e.start)).toEqual([10]);
  });

  it("never writes a file whose editor buffer is dirty, and says which", () => {
    const plan = planApply(
      preview([file("/a", [0]), file("/b", [0])]),
      new Set(),
      new Set(["/a"]),
    );
    expect(plan.files.map((f) => f.path)).toEqual(["/b"]);
    expect(plan.skippedDirty).toEqual(["a"]);
  });

  it("does not report a dirty file the user already excluded", () => {
    const a = file("/a", [0]);
    const plan = planApply(
      preview([a]),
      toggleFile(a, new Set()),
      new Set(["/a"]),
    );
    expect(plan.skippedDirty).toEqual([]);
  });
});

describe("include toggles", () => {
  it("a file checkbox is tri-state and toggles its matches together", () => {
    const a = file("/a", [0, 10]);
    expect(fileCheck(a, new Set())).toBe("checked");
    const partial = toggleEdit("/a", a.edits[1], new Set());
    expect(fileCheck(a, partial)).toBe("indeterminate");
    const off = toggleFile(a, partial);
    expect(fileCheck(a, off)).toBe("unchecked");
    expect(fileCheck(a, toggleFile(a, off))).toBe("checked");
  });

  it("keys a match by path and offset so equal offsets in two files differ", () => {
    expect(editKey("/a", edit(0))).not.toBe(editKey("/b", edit(0)));
  });
});

describe("summarizeApply", () => {
  it("separates written files from conflicts and failures", () => {
    const p = preview([file("/a", [0]), file("/b", [0]), file("/c", [0])]);
    const s = summarizeApply(
      [
        {
          path: "/a",
          outcome: "written",
          replaced: 2,
          mtime: 1,
          message: null,
        },
        {
          path: "/b",
          outcome: "conflict",
          replaced: 0,
          mtime: null,
          message: "changed on disk since the preview",
        },
        {
          path: "/c",
          outcome: "failed",
          replaced: 0,
          mtime: null,
          message: "not UTF-8",
        },
      ],
      p,
      ["d"],
    );
    expect(s.written).toBe(1);
    expect(s.replaced).toBe(2);
    expect(s.conflicts).toEqual([
      { rel: "b", message: "changed on disk since the preview" },
    ]);
    expect(s.failed).toEqual([{ rel: "c", message: "not UTF-8" }]);
    expect(s.skippedDirty).toEqual(["d"]);
  });
});

describe("input helpers", () => {
  it("splits glob lists on commas and drops blanks", () => {
    expect(parseGlobList(" src, *.ts ,, docs/ ")).toEqual([
      "src",
      "*.ts",
      "docs/",
    ]);
    expect(parseGlobList("")).toEqual([]);
  });

  it("maps Alt chords to flags and ignores other modifiers", () => {
    const k = (code: string, extra: Partial<Record<string, boolean>> = {}) => ({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      code,
      ...extra,
    });
    expect(flagForKey(k("KeyC"))).toBe("caseSensitive");
    expect(flagForKey(k("KeyW"))).toBe("wholeWord");
    expect(flagForKey(k("KeyR"))).toBe("regex");
    expect(flagForKey(k("KeyR", { ctrlKey: true }))).toBeNull();
    expect(flagForKey(k("KeyX"))).toBeNull();
  });
});
