import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";

// Syntax palette shared by every locally-defined theme. The editor renders as
// glass over the app surface, so `background`/`selection`/`caret` here are
// overridden by buildSharedExtensions(), only the syntax colors really land.
export type Palette = {
  mode: "light" | "dark";
  bg: string;
  fg: string;
  caret: string;
  /** Derived palettes omit it: the uiw rule that reads it carries !important
   * and would outrank the shared editor rule that owns the surface. */
  selection?: string;
  lineHighlight: string;
  gutterFg: string;
  comment: string;
  keyword: string;
  boldKeyword?: boolean;
  string: string;
  number: string;
  /** Booleans / language constants / atoms. Falls back to `number`. */
  constant?: string;
  func: string;
  variable: string;
  property: string;
  type: string;
  operator: string;
  tag: string;
  tagBracket?: string;
  attr: string;
  attrValue?: string;
  heading: string;
  link: string;
  invalid: string;
};

export function build(p: Palette): Extension {
  return createTheme({
    theme: p.mode,
    settings: {
      background: p.bg,
      foreground: p.fg,
      caret: p.caret,
      selection: p.selection,
      selectionMatch: p.selection,
      lineHighlight: p.lineHighlight,
      gutterBackground: p.bg,
      gutterForeground: p.gutterFg,
    },
    styles: [
      {
        tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
        color: p.comment,
        fontStyle: "italic",
      },
      {
        tag: [
          t.keyword,
          t.modifier,
          t.controlKeyword,
          t.operatorKeyword,
          t.moduleKeyword,
          t.self,
        ],
        color: p.keyword,
        ...(p.boldKeyword ? { fontWeight: "bold" } : {}),
      },
      {
        tag: [t.string, t.special(t.string), t.regexp, t.character],
        color: p.string,
      },
      { tag: [t.number], color: p.number },
      {
        tag: [t.bool, t.null, t.atom, t.constant(t.name)],
        color: p.constant ?? p.number,
      },
      {
        tag: [
          t.function(t.variableName),
          t.function(t.propertyName),
          t.labelName,
          t.macroName,
        ],
        color: p.func,
      },
      {
        tag: [
          t.definition(t.variableName),
          t.variableName,
          t.local(t.variableName),
        ],
        color: p.variable,
      },
      { tag: [t.propertyName, t.special(t.propertyName)], color: p.property },
      {
        tag: [t.typeName, t.className, t.namespace, t.changed, t.annotation],
        color: p.type,
      },
      {
        tag: [
          t.operator,
          t.punctuation,
          t.separator,
          t.bracket,
          t.derefOperator,
        ],
        color: p.operator,
      },
      { tag: [t.tagName], color: p.tag },
      { tag: [t.angleBracket], color: p.tagBracket ?? p.tag },
      { tag: [t.attributeName], color: p.attr },
      { tag: [t.attributeValue], color: p.attrValue ?? p.attr },
      { tag: [t.heading], color: p.heading, fontWeight: "bold" },
      { tag: [t.link, t.url], color: p.link, textDecoration: "underline" },
      { tag: [t.emphasis], fontStyle: "italic" },
      { tag: [t.strong], fontWeight: "bold" },
      { tag: [t.invalid], color: p.invalid },
      { tag: [t.meta, t.processingInstruction], color: p.comment },
    ],
  });
}

function varPalette(mode: "light" | "dark"): Palette {
  return {
    mode,
    // buildSharedExtensions() owns the editor surface, so these stay inert.
    bg: "transparent",
    caret: "transparent",
    lineHighlight: "transparent",
    fg: "var(--foreground)",
    gutterFg: "var(--syntax-gutter-fg)",
    comment: "var(--syntax-comment)",
    keyword: "var(--syntax-keyword)",
    string: "var(--syntax-string)",
    number: "var(--syntax-number)",
    constant: "var(--syntax-constant)",
    func: "var(--syntax-func)",
    variable: "var(--syntax-variable)",
    property: "var(--syntax-property)",
    type: "var(--syntax-type)",
    operator: "var(--syntax-operator)",
    tag: "var(--syntax-tag)",
    tagBracket: "var(--syntax-tag-bracket)",
    attr: "var(--syntax-attr)",
    attrValue: "var(--syntax-attr-value)",
    heading: "var(--syntax-heading)",
    link: "var(--syntax-link)",
    invalid: "var(--syntax-invalid)",
  };
}

// Built once. A theme switch only changes the variables these read, so the
// extension identity is stable and no mounted editor reconfigures.
export const derivedLight = build(varPalette("light"));
export const derivedDark = build(varPalette("dark"));
