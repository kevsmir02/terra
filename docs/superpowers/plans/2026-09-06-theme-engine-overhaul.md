# Theme Engine Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Terra theme able to change the chrome's structure (frame and divider style, corner shape, label typography, icon set, shadows, blur, wallpaper) without touching a component, and rebuild the Nothing theme to its reference as the acceptance case.

**Architecture:** The resolution pipeline (`types.ts`, `resolveVariant.ts`, `resolveTheme.ts`, `oklab.ts`, `applyTheme.ts`) stays. The theme owns the scales Tailwind utilities resolve through (radius, pill radius, shadow tint, blur factor, border width and style) via the `@theme inline` bridge and `@utility` re-emissions in `globals.css`; one `terra-label` utility carries casing and tracking for chrome text; dividers become real borders; the explorer icon set and the wallpaper become theme-declared; a source-scan test forbids the literal escape hatches so the contract cannot rot. Fonts collapse to the system JetBrainsMono Nerd Font. Custom JSON themes and three builtins are removed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4.3 (`@theme inline`, `@utility`), Vitest, Biome, pnpm. Tauri commands are untouched.

**Spec:** `docs/superpowers/specs/2026-09-06-theme-engine-overhaul-design.md`

## Global Constraints

- pnpm only; never npm, npx, or yarn.
- No em-dash and no emoji anywhere: code, comments, commits, docs, tests.
- Comments default to none; when needed, one or two lines on why.
- Frontend imports use `@/...`, never a relative path across modules.
- Commits: `type(scope): summary`, imperative. No `Co-Authored-By`, no "Generated with" line.
- Every task ends green on `pnpm lint`, `pnpm check-types`, `pnpm test`. Task 9 also runs `pnpm build && pnpm size:eager`, `pnpm knip`, `pnpm audit --prod`, `pnpm audit`.
- `pnpm lint` runs with `--error-on-warnings`; an exception needs `// biome-ignore <rule>: <reason>`.
- Linux only. No platform code.
- The app font is the system-installed `JetBrainsMono Nerd Font` (UI, editor) and `JetBrainsMono Nerd Font Mono` (terminal default). Never bundle a font.
- The contract test allowlist maps a file path to a reason; adding an entry is a reviewed change and the commit message names it.
- Work happens on branch `theme-overhaul` (already created; the spec is committed on it as f8100ba).

## Deviations from the spec, recorded here and folded into the spec in Task 9

- `rounded-full` is retired instead of re-emitted. A Tailwind `@utility` with the same name as a core utility is merged with it and the core declaration wins (verified with `tailwindcss` `compile`). Pills use a new `rounded-pill` utility that reads `--radius-pill`; geometric circles use `rounded-circle`; the contract test forbids `rounded-full`.
- No tracking-scale bridge. Chrome labels get tracking from `terra-label`; the named `tracking-*` steps keep Tailwind's values and only arbitrary `tracking-[...]` is forbidden.
- The `editorTheme` field is removed from the `Theme` type. Every kept builtin declares `terminal.ansi`, so the derived path always won and the pairing was dead configuration.
- The statusbar breadcrumb path stays content (lowercase), matching the reference mockup; statusbar chips and the theme name pill follow the theme.
- Dividers converted to borders are 1 px unless they carry a surface class themselves; `--surface-border-width` is registered non-inheriting.
- Task order differs from the spec's list: custom-theme removal and the font change land before the theme-file contract, so the validator and the font tokens are never updated for fields that are about to be deleted.

## File structure

Created:

- `src/app/theme-contract.test.ts`: source scan and CSS assertions locking the consumption contract.
- `src/modules/theme/wallpaper.ts` and `wallpaper.test.ts`: pure `wallpaperAllowed`.
- `src/modules/explorer/lib/iconProvider.tsx`: `FileIcon`, `IconProvider`, `useIconProvider`, `FileIconView`.
- `src/modules/explorer/lib/nerdIcons.ts` and `nerdIcons.test.ts`: Nerd Font glyph provider.
- `src/modules/explorer/lib/catppuccinIcons.ts`: today's resolver, loaded lazily.
- `scripts/theme-token-reference-sync.mjs`: rewrites the token block in `THEME.md` from `TOKENS`.
- `docs/adr/0003-theme-consumption-through-scales.md`.

Deleted:

- `src/modules/theme/{customThemes,themeFiles,useThemeFileEditing,validateTheme,diagnostics,fonts,resolveTerminalFont}.ts` and their tests, `__snapshots__/resolveTheme.test.ts.snap`.
- `src/modules/theme/themes/{stardew,windows-xp,gameboy}.ts`.
- `src/styles/{fonts,space-grotesk,pixelify-sans}.css`.
- `src/modules/explorer/lib/iconResolver.ts` (replaced by the two providers).

Modified: `src/styles/globals.css`, `src/modules/theme/{types,tokens,resolveTheme,resolveEditorTheme,ThemeProvider,SurfaceLayer,index}.ts(x)` and tests, the five kept themes, `src/components/ui/{separator,resizable,command,dropdown-menu,context-menu,select,slider,switch,tabs,scroll-area,alert-dialog,checkbox}.tsx`, the chrome components listed per task, `src/lib/fonts.ts`, `knip.json`, `package.json`, `eager-budget.json`, `THEME.md`, `TERRA.md`.

---

### Task 1: Frame border style and dividers as borders

No visible change on any current theme (they all set `borderStyle: "solid"`). Unblocks dotted and dashed frames and dividers for every theme.

**Files:**
- Modify: `src/styles/globals.css:265-272`
- Modify: `src/components/ui/separator.tsx:18`
- Modify: `src/components/ui/resizable.tsx:36`
- Modify: `src/components/ui/command.tsx:142`
- Modify: `src/components/ui/dropdown-menu.tsx:185`
- Modify: `src/components/ui/context-menu.tsx:222`
- Modify: `src/components/ui/select.tsx:137`
- Modify: `src/modules/header/Header.tsx:131,161`
- Create: `src/app/theme-contract.test.ts`
- Test: `src/styles/surfaceClasses.test.ts`

**Interfaces:**
- Produces: `src/app/theme-contract.test.ts` with a `scan(rules)` helper later tasks extend. Rule shape: `{ id: string; pattern: RegExp; message: string }`. Allowlist shape: `Record<string, string>` mapping repo-relative path to reason.

- [ ] **Step 1: Write the failing CSS assertion**

Append to `src/styles/surfaceClasses.test.ts` inside `describe("surface classes", ...)`:

```ts
  it("draws the window frame in the theme's border style", () => {
    const i = CSS.indexOf('html[data-chrome="borderless"] #root,');
    expect(i).toBeGreaterThan(-1);
    const rule = CSS.slice(i, CSS.indexOf("}", i));
    expect(rule).toContain(
      "border: var(--frame-border-width, 1px) var(--border-style, solid) var(--border)",
    );
  });
```

- [ ] **Step 2: Write the failing divider scan**

Create `src/app/theme-contract.test.ts`:

```ts
import { globSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Locks the theme consumption contract: chrome reaches the theme through the
// scales and role classes in globals.css, never through a literal a theme
// cannot see. A hit here is fixed at the site; the allowlist is for the few
// places where a literal is the design (a brand mark, a video surface).
const ROOT = path.resolve(__dirname, "../..");

type Rule = { id: string; pattern: RegExp; message: string };

const ALLOWLIST: Record<string, string> = {};

const RULES: Rule[] = [
  {
    id: "divider-fill",
    pattern: /\b(h-px|w-px)\b[^"'`]*\bbg-border\b|\bbg-border\b[^"'`]*\b(h-px|w-px)\b/,
    message: "a divider is a border, not a bg-border fill; it must take --border-style",
  },
];

function sourceFiles(): string[] {
  return globSync("src/**/*.{ts,tsx}", { cwd: ROOT }).filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"),
  );
}

function scan(rules: Rule[]): string[] {
  const offenders: string[] = [];
  for (const rel of sourceFiles()) {
    if (rel in ALLOWLIST) continue;
    const src = readFileSync(path.resolve(ROOT, rel), "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      for (const rule of rules) {
        if (rule.pattern.test(line)) {
          offenders.push(`${rel}:${i + 1} [${rule.id}] ${rule.message}`);
        }
      }
    });
  }
  return offenders;
}

describe("theme consumption contract", () => {
  it("has no literal escape hatch outside the allowlist", () => {
    expect(scan(RULES)).toEqual([]);
  });

  it("names a reason for every allowlisted file, and every file exists", () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, file).toBeGreaterThan(10);
      expect(() => readFileSync(path.resolve(ROOT, file))).not.toThrow();
    }
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `pnpm vitest run src/styles/surfaceClasses.test.ts src/app/theme-contract.test.ts`
Expected: FAIL. The frame assertion fails on the literal `solid`; the scan lists `separator.tsx`, `resizable.tsx`, `command.tsx`, `dropdown-menu.tsx`, `context-menu.tsx`, `select.tsx`, and two `Header.tsx` lines. Any other line it reports is converted the same way in Step 5: the fill becomes a zero-size box with a `border-t` or `border-l`.

- [ ] **Step 4: Fix the frame rule**

In `src/styles/globals.css`, in the `html[data-chrome="borderless"] #root, html[data-chrome="borderless"] #settings-root` rule, replace:

```css
  border: var(--frame-border-width, 1px) solid var(--border);
```

with:

```css
  border: var(--frame-border-width, 1px) var(--border-style, solid) var(--border);
```

- [ ] **Step 5: Convert the dividers**

`src/components/ui/separator.tsx`, the `cn(...)` first argument becomes:

```ts
        "shrink-0 data-horizontal:h-0 data-horizontal:w-full data-horizontal:border-t data-vertical:w-0 data-vertical:self-stretch data-vertical:border-l",
```

`src/components/ui/resizable.tsx`, in `ResizableHandle` replace the leading part of the class string `"relative flex w-px items-center justify-center bg-border ring-offset-background` with `"relative flex w-0 items-center justify-center border-l ring-offset-background` and replace `aria-[orientation=horizontal]:h-px aria-[orientation=horizontal]:w-full` with `aria-[orientation=horizontal]:h-0 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:border-l-0 aria-[orientation=horizontal]:border-t`. The inner grip `<div className="z-10 flex h-6 w-1 shrink-0 rounded-lg bg-border" />` stays: it is a grip, not a divider.

`src/components/ui/command.tsx` `CommandSeparator`: `"my-1.5 h-px bg-border/(--emph-medium)"` becomes `"my-1.5 h-0 border-t border-border/(--emph-medium)"`.

`src/components/ui/dropdown-menu.tsx` `DropdownMenuSeparator` and `src/components/ui/context-menu.tsx` `ContextMenuSeparator`: `"-mx-1.5 my-1.5 h-px bg-border/(--emph-medium)"` becomes `"-mx-1.5 my-1.5 h-0 border-t border-border/(--emph-medium)"`.

`src/components/ui/select.tsx` `SelectSeparator`: `"pointer-events-none -mx-1.5 my-1.5 h-px bg-border"` becomes `"pointer-events-none -mx-1.5 my-1.5 h-0 border-t"`.

`src/modules/header/Header.tsx`: `<span className="mx-1 h-full w-px shrink-0 bg-border/(--emph-strong)" />` becomes `<span className="mx-1 h-full w-0 shrink-0 border-l border-border/(--emph-strong)" />` and `<span className="ml-1 h-5 w-px shrink-0 bg-border/(--emph-strong)" />` becomes `<span className="ml-1 h-5 w-0 shrink-0 border-l border-border/(--emph-strong)" />`.

- [ ] **Step 6: Run the tests, lint, and types**

Run: `pnpm vitest run src/styles src/app && pnpm lint && pnpm check-types`
Expected: PASS.

- [ ] **Step 7: Run the app and look**

Run: `pnpm tauri dev` (or the project's `run` skill). Open a dropdown, the command palette, a select, and drag a pane handle. Dividers look identical to before on Terra Default. Switch to Nothing in Settings: the window frame and every divider are now dotted.

- [ ] **Step 8: Commit**

```bash
git add src/styles/globals.css src/styles/surfaceClasses.test.ts src/app/theme-contract.test.ts src/components/ui/separator.tsx src/components/ui/resizable.tsx src/components/ui/command.tsx src/components/ui/dropdown-menu.tsx src/components/ui/context-menu.tsx src/components/ui/select.tsx src/modules/header/Header.tsx
git commit -m "fix(theme): draw the frame and every divider in the theme's border style"
```

---

### Task 2: Theme-owned scales, pill and circle radii

**Files:**
- Modify: `src/styles/globals.css` (`@theme inline` block at lines 11-66, `@utility` block at lines 68-76)
- Modify: 36 `rounded-full` sites (listed in Step 5), `src/components/ui/checkbox.tsx:16`, `src/modules/spaces/SpaceAvatar.tsx:8`, `src/modules/git-history/GitHistoryPane.tsx:753`, `src/modules/source-control/SourceControlPanel.tsx:101,1403`, `src/components/ui/slider.tsx:50`
- Test: `src/styles/tailwindTokens.test.ts`, `src/app/theme-contract.test.ts`

**Interfaces:**
- Produces CSS variables read by later tasks: `--radius-pill` (fallback `9999px`), `--fx-shadow-color` (fallback per size, Tailwind's default alpha), `--fx-blur-factor` (fallback `1`). Utilities `rounded-pill`, `rounded-circle`.

- [ ] **Step 1: Write the failing compile test**

Append to `src/styles/tailwindTokens.test.ts`:

```ts
describe("theme-owned scales", () => {
  const inline = () =>
    GLOBALS.slice(
      GLOBALS.indexOf("@theme inline"),
      GLOBALS.indexOf("@utility border"),
    );
  const utilities = () =>
    GLOBALS.split("\n").filter((l) => l.trimStart().startsWith("@utility rounded-"));

  it("routes every shadow utility through the theme's shadow tint", async () => {
    const css = await build(`@import "tailwindcss";\n${inline()}`, [
      "shadow-2xs", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg",
      "shadow-xl", "shadow-2xl", "shadow", "shadow-inner",
    ]);
    const blocks = css.match(/\.shadow[^{]*\{[^}]*\}/g) ?? [];
    expect(blocks).toHaveLength(9);
    for (const b of blocks) expect(b).toContain("var(--fx-shadow-color, rgb(0 0 0 /");
  });

  it("multiplies every blur step by the theme's blur factor", async () => {
    const css = await build(`@import "tailwindcss";\n${inline()}`, [
      "backdrop-blur", "backdrop-blur-xs", "backdrop-blur-sm", "backdrop-blur-md",
      "backdrop-blur-lg", "backdrop-blur-xl", "backdrop-blur-2xl", "backdrop-blur-3xl",
    ]);
    const blocks = css.match(/\.backdrop-blur[^{]*\{[^}]*\}/g) ?? [];
    expect(blocks).toHaveLength(8);
    for (const b of blocks) expect(b).toContain("blur(calc(var(--fx-blur-factor, 1) *");
  });

  it("scales rounded-xs with the theme radius like the other steps", () => {
    expect(inline()).toContain("--radius-xs: calc(var(--radius) * 0.4)");
  });

  it("gives pills a theme radius and circles a fixed one", async () => {
    const css = await build(
      `@import "tailwindcss";\n${utilities().join("\n")}`,
      ["rounded-pill", "rounded-circle"],
    );
    expect(css).toContain(".rounded-pill {\n    border-radius: var(--radius-pill, 9999px);");
    expect(css).toContain(".rounded-circle {\n    border-radius: 50%;");
  });
});
```

- [ ] **Step 2: Extend the contract scan**

In `src/app/theme-contract.test.ts` add to `RULES`:

```ts
  {
    id: "rounded-full",
    pattern: /\brounded-full\b/,
    message: "use rounded-pill (theme radius) or rounded-circle (geometric circle)",
  },
  {
    id: "arbitrary-shape",
    pattern: /\b(rounded(-[trblse]{1,2})?|shadow|blur|backdrop-blur)-\[(?!inherit\])/,
    message: "arbitrary shape value; use a scale step the theme owns",
  },
  {
    id: "border-style-literal",
    pattern: /\bborder-(solid|dashed|dotted|double)\b/,
    message: "border style belongs to the theme (--border-style)",
  },
  {
    id: "palette-colour",
    pattern:
      /\b(bg|text|border|ring|fill|stroke|from|to|via|outline|shadow|decoration)-(white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d{2,3})?(\/|\b)/,
    message: "Tailwind palette colour; use a semantic token (bg-card, text-muted-foreground, ...)",
  },
  {
    id: "raw-colour",
    pattern: /(className|class|style)=[^\n]*(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\()/,
    message: "raw colour in markup; use a theme token",
  },
```

And set the allowlist:

```ts
const ALLOWLIST: Record<string, string> = {
  "src/modules/preview/PreviewPane.tsx":
    "the web preview iframe paints white behind the page, like a browser",
  "src/modules/device/DevicePreviewPane.tsx":
    "the device video surface is black letterboxing around the stream",
  "src/components/ui/dialog.tsx": "the modal scrim is a neutral dark wash by design",
  "src/components/ui/alert-dialog.tsx": "the modal scrim is a neutral dark wash by design",
};
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/styles/tailwindTokens.test.ts src/app/theme-contract.test.ts`
Expected: FAIL. The compile tests find no `--fx-` variables; the scan lists the 36 `rounded-full` sites, three arbitrary radii, two `shadow-black`, the slider's `bg-white ring-black/10`, and the orange import message in `ThemesSection.tsx`.

- [ ] **Step 4: Add the scale bridges**

In `src/styles/globals.css`, inside `@theme inline { ... }`, after the `--radius-4xl` line add:

```css
    --radius-xs: calc(var(--radius) * 0.4);
    --shadow-2xs: 0 1px var(--fx-shadow-color, rgb(0 0 0 / 0.05));
    --shadow-xs: 0 1px 2px 0 var(--fx-shadow-color, rgb(0 0 0 / 0.05));
    --shadow-sm: 0 1px 3px 0 var(--fx-shadow-color, rgb(0 0 0 / 0.1)), 0 1px 2px -1px var(--fx-shadow-color, rgb(0 0 0 / 0.1));
    --shadow-md: 0 4px 6px -1px var(--fx-shadow-color, rgb(0 0 0 / 0.1)), 0 2px 4px -2px var(--fx-shadow-color, rgb(0 0 0 / 0.1));
    --shadow-lg: 0 10px 15px -3px var(--fx-shadow-color, rgb(0 0 0 / 0.1)), 0 4px 6px -4px var(--fx-shadow-color, rgb(0 0 0 / 0.1));
    --shadow-xl: 0 20px 25px -5px var(--fx-shadow-color, rgb(0 0 0 / 0.1)), 0 8px 10px -6px var(--fx-shadow-color, rgb(0 0 0 / 0.1));
    --shadow-2xl: 0 25px 50px -12px var(--fx-shadow-color, rgb(0 0 0 / 0.25));
    --shadow: 0 1px 3px 0 var(--fx-shadow-color, rgb(0 0 0 / 0.1)), 0 1px 2px -1px var(--fx-shadow-color, rgb(0 0 0 / 0.1));
    --shadow-inner: inset 0 2px 4px 0 var(--fx-shadow-color, rgb(0 0 0 / 0.05));
    --blur-xs: calc(var(--fx-blur-factor, 1) * 4px);
    --blur-sm: calc(var(--fx-blur-factor, 1) * 8px);
    --blur-md: calc(var(--fx-blur-factor, 1) * 12px);
    --blur-lg: calc(var(--fx-blur-factor, 1) * 16px);
    --blur-xl: calc(var(--fx-blur-factor, 1) * 24px);
    --blur-2xl: calc(var(--fx-blur-factor, 1) * 40px);
    --blur-3xl: calc(var(--fx-blur-factor, 1) * 64px);
    --blur: calc(var(--fx-blur-factor, 1) * 8px);
```

After the five `@utility border*` lines add:

```css
/* A pill follows the theme (a brutalist theme squares its chips); a circle is
 * geometry and never does. Tailwind merges a same-named @utility with its own
 * and wins, so rounded-full is retired rather than re-emitted. */
@utility rounded-pill { border-radius: var(--radius-pill, 9999px); }
@utility rounded-circle { border-radius: 50%; }
```

- [ ] **Step 5: Migrate every `rounded-full`**

Replace with `rounded-circle` (geometric dots, swatches, icon discs):

- `src/modules/agents/components/NotificationBell.tsx:68` and `:157`
- `src/modules/spaces/SpaceSwitcher.tsx:622`
- `src/settings/components/LspServersGroup.tsx:86`
- `src/modules/lsp/components/LspStatusPill.tsx:85` and `:245`
- `src/modules/spaces/components/SpaceSettingsPopover.tsx:141` and `:155`
- `src/modules/git-history/GitHistoryPane.tsx:785`
- `src/modules/tabs/TabBar.tsx:463`
- `src/modules/source-control/SourceControlPanel.tsx:838`, `:1026`, `:1412`
- `src/components/ui/alert-dialog.tsx:108`

Replace with `rounded-pill` (chips, badges, toggles, thumbs, bars, buttons):

- `src/components/ui/switch.tsx:18` and `:25`
- `src/components/ui/scroll-area.tsx:47`
- `src/components/ui/tabs.tsx:26` and `:64`
- `src/components/ui/slider.tsx:39` and `:50`
- `src/modules/agents/components/NotificationBell.tsx:249` and `:266`
- `src/modules/statusbar/StatusBar.tsx:36`
- `src/modules/spaces/SpaceSwitcher.tsx:599`
- `src/modules/sidebar/SidebarRail.tsx:74`
- `src/modules/lsp/components/LspStatusPill.tsx:28` and `:124`
- `src/modules/preview/DevServerChip.tsx:22` and `:43`
- `src/modules/tabs/TabBar.tsx:619`
- `src/modules/source-control/SourceControlPanel.tsx:1102` and `:1177`

A single command does the pill half after the circle sites are edited by hand:

```bash
grep -rl --include=*.tsx "rounded-full" src | xargs sed -i 's/\brounded-full\b/rounded-pill/g'
```

Run it only after the fourteen circle sites already say `rounded-circle`.

- [ ] **Step 6: Fix the remaining literals**

- `src/components/ui/checkbox.tsx:16`: `rounded-[5px]` becomes `rounded-sm`.
- `src/modules/spaces/SpaceAvatar.tsx:8`: `rounded-[5px]` becomes `rounded-sm`.
- `src/modules/git-history/GitHistoryPane.tsx:753`: `rounded-[3px]` becomes `rounded-xs`.
- `src/modules/source-control/SourceControlPanel.tsx:101`: delete `shadow-black/30`. `:1403`: delete `shadow-black/15`. The theme tint now applies.
- `src/components/ui/slider.tsx:50`: `bg-white` becomes `bg-background`, `ring-black/10` becomes `ring-border`.
- `src/settings/sections/ThemesSection.tsx:214`: `border-orange-500/40 bg-orange-500/10 text-orange-500` becomes `border-status-warning/(--emph-soft) bg-status-warning/(--emph-faint) text-status-warning` (the block itself goes in Task 3).

- [ ] **Step 7: Run tests, lint, types**

Run: `pnpm vitest run src/styles src/app && pnpm lint && pnpm check-types`
Expected: PASS.

- [ ] **Step 8: Look at it running**

Terra Default must be pixel-identical: pills still round, shadows and blur unchanged, dots still round. In the browser devtools (or WebKit inspector), set `--fx-shadow-color: transparent` and `--fx-blur-factor: 0` on `<html>`: every shadow and blur disappears. Set `--radius-pill: 2px`: chips square, dots stay round.

- [ ] **Step 9: Commit**

```bash
git add src/styles/globals.css src/styles/tailwindTokens.test.ts src/app/theme-contract.test.ts src/components/ui src/modules src/settings
git commit -m "feat(theme): let the theme own the shadow, blur, and pill radius scales"
```

---

### Task 3: Remove custom JSON theme files

**Files:**
- Delete: `src/modules/theme/customThemes.ts`, `customThemes.test.ts`, `themeFiles.ts`, `themeFiles.test.ts`, `useThemeFileEditing.ts`, `validateTheme.ts`, `validateTheme.test.ts`, `diagnostics.ts`
- Modify: `src/modules/theme/ThemeProvider.tsx`, `src/modules/theme/index.ts`, `src/modules/theme/resolveEditorTheme.ts`, `src/modules/theme/resolveEditorTheme.test.ts`, `src/modules/theme/themes/builtins.test.ts`, `src/modules/editor/lib/useEditorThemeExt.ts`, `src/modules/command-palette/CommandPalette.tsx:62,83,91`, `src/app/App.tsx:84,296`
- Rewrite: `src/settings/sections/ThemesSection.tsx`

**Interfaces:**
- Produces: `useTheme()` no longer exposes `customThemes`; `resolveEditorTheme(pref, themeId, mode)` (three arguments).

- [ ] **Step 1: Delete the files**

```bash
git rm src/modules/theme/customThemes.ts src/modules/theme/customThemes.test.ts src/modules/theme/themeFiles.ts src/modules/theme/themeFiles.test.ts src/modules/theme/useThemeFileEditing.ts src/modules/theme/validateTheme.ts src/modules/theme/validateTheme.test.ts src/modules/theme/diagnostics.ts
```

- [ ] **Step 2: Update ThemeProvider**

In `src/modules/theme/ThemeProvider.tsx`: remove the `listCustomThemes, onCustomThemesChange` import; remove `customThemes: Theme[];` from `ThemeProviderState`; change `resolveTheme` to:

```ts
function resolveTheme(id: string): Theme {
  return getBuiltinTheme(id) ?? getDefaultTheme();
}
```

Remove the `const [customThemes, setCustomThemes] = useState<Theme[]>([]);` line and the whole `useEffect` that calls `listCustomThemes`. Change the `activeTheme` memo to `useMemo(() => resolveTheme(effectiveId), [effectiveId])`. Remove `customThemes` from the context value object and its dependency array.

- [ ] **Step 3: Update the barrel, editor pairing, palette, and App**

`src/modules/theme/index.ts`: delete the line `export { useThemeFileEditing } from "./useThemeFileEditing";`.

`src/modules/theme/resolveEditorTheme.ts`: signature becomes `resolveEditorTheme(pref: EditorThemePref, themeId: string, mode: "light" | "dark")` and the theme lookup becomes `const theme = getBuiltinTheme(themeId) ?? getDefaultTheme();`. Update every call in `src/modules/theme/resolveEditorTheme.test.ts` to drop the array argument.

`src/modules/editor/lib/useEditorThemeExt.ts`: destructure `{ themeId, resolvedMode }`, call `resolveEditorTheme(pref, themeId, resolvedMode)`, dependency array `[pref, themeId, resolvedMode]`.

`src/modules/command-palette/CommandPalette.tsx`: line 62 destructure without `customThemes`; line 83 `const all = listBuiltinThemes();`; line 91 drop `customThemes` from the dependency array.

`src/app/App.tsx`: line 84 becomes `import { ThemeProvider } from "@/modules/theme";`; delete line 296 `useThemeFileEditing({ tabsRef, openFileTab });`. If `openFileTab` is now unused, `pnpm lint` says so; keep it if other code uses it.

- [ ] **Step 4: Rewrite the builtins test's validation case**

In `src/modules/theme/themes/builtins.test.ts` remove the `validateTheme` import and replace the first `it.each` block with:

```ts
  it.each(builtins.map((t) => [t.id, t] as const))(
    "%s has a kebab-case id and a name",
    (_id, theme) => {
      expect(theme.id).toMatch(/^[a-z0-9][a-z0-9-]{1,63}$/);
      expect(theme.name.trim().length).toBeGreaterThan(0);
    },
  );
```

- [ ] **Step 5: Rewrite ThemesSection**

Replace `src/settings/sections/ThemesSection.tsx` with:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  EDITOR_THEME_AUTO,
  EDITOR_THEME_LABELS,
  EDITOR_THEME_MODE,
  EDITOR_THEMES,
  type EditorThemePref,
  setBackgroundBlur,
  setBackgroundImageId,
  setBackgroundKind,
  setBackgroundOpacity,
  setEditorTheme,
} from "@/modules/settings/store";
import { listBuiltinThemes, useTheme } from "@/modules/theme";
import {
  deleteBgImage,
  importBgImageFromFile,
} from "@/modules/theme/bgImageStore";
import { useRef, useState } from "react";
import { SectionHeader } from "../components/SectionHeader";

export function ThemesSection() {
  const { themeId, setThemeId, resolvedMode } = useTheme();
  const themes = listBuiltinThemes();

  const [bgError, setBgError] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const editorThemePref = usePreferencesStore((s) => s.editorTheme);
  const backgroundKind = usePreferencesStore((s) => s.backgroundKind);
  const backgroundImageId = usePreferencesStore((s) => s.backgroundImageId);
  const backgroundOpacity = usePreferencesStore((s) => s.backgroundOpacity);
  const backgroundBlur = usePreferencesStore((s) => s.backgroundBlur);

  const onPickBgFile = () => bgInputRef.current?.click();

  const handleBgFiles = async (files: FileList | null) => {
    setBgError(null);
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      setBgError(`${file.name}: not an image`);
      return;
    }
    try {
      const prev = backgroundImageId;
      const { id } = await importBgImageFromFile(file);
      await setBackgroundImageId(id);
      await setBackgroundKind("image");
      if (prev && prev !== id) await deleteBgImage(prev).catch(() => undefined);
    } catch (e) {
      setBgError(e instanceof Error ? e.message : "failed to import image");
    }
  };

  const onRemoveBackground = async () => {
    setBgError(null);
    const prev = backgroundImageId;
    await setBackgroundKind("none");
    await setBackgroundImageId(null);
    if (prev) await deleteBgImage(prev).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Themes"
        description="Theme, editor colours, and background image."
      />

      <div className="flex flex-col gap-2">
        <Label>Theme</Label>
        <div className="grid grid-cols-2 gap-2">
          {themes.map((t) => {
            const v =
              t.variants[resolvedMode] ?? t.variants.dark ?? t.variants.light;
            const c = v?.colors;
            const swatchBg = c?.background ?? "var(--background)";
            const swatchFg = c?.foreground ?? "var(--foreground)";
            const swatchAccent = c?.primary ?? c?.accent ?? "var(--accent)";
            const swatchMuted = c?.muted ?? "var(--muted)";
            const selected = themeId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setThemeId(t.id)}
                className={cn(
                  "group flex items-center gap-3 rounded-lg border p-2.5 text-left transition-all",
                  selected
                    ? "border-foreground/(--emph-strong) ring-1 ring-foreground/(--emph-subtle)"
                    : "border-border/(--emph-strong) hover:border-border",
                )}
              >
                <div
                  className="flex h-10 w-14 shrink-0 items-center justify-center gap-1 rounded-md border border-border/(--emph-soft)"
                  style={{ background: swatchBg }}
                >
                  <span className="h-5 w-2 rounded-sm" style={{ background: swatchAccent }} />
                  <span className="h-5 w-2 rounded-sm" style={{ background: swatchFg, opacity: 0.7 }} />
                  <span className="h-5 w-2 rounded-sm" style={{ background: swatchMuted }} />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12.5px] font-medium">{t.name}</span>
                  {t.description ? (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {t.description}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <Label>Editor theme</Label>
            <span className="text-[11px] text-muted-foreground">
              Syntax colors for the code editor. Auto follows the app theme.
            </span>
          </div>
          <Select
            value={editorThemePref}
            onValueChange={(v) => void setEditorTheme(v as EditorThemePref)}
          >
            <SelectTrigger size="sm" className="h-8 w-44 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EDITOR_THEME_AUTO} className="text-[12px]">
                Auto (match app theme)
              </SelectItem>
              <SelectSeparator />
              {[...EDITOR_THEMES]
                .sort(
                  (a, b) =>
                    (EDITOR_THEME_MODE[a] === resolvedMode ? 0 : 1) -
                    (EDITOR_THEME_MODE[b] === resolvedMode ? 0 : 1),
                )
                .map((id) => (
                  <SelectItem
                    key={id}
                    value={id}
                    disabled={EDITOR_THEME_MODE[id] !== resolvedMode}
                    className="text-[12px]"
                  >
                    {EDITOR_THEME_LABELS[id]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for files; the adjacent file picker is the keyboard path */}
      <div
        role="presentation"
        className="flex flex-col gap-2"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          e.preventDefault();
          void handleBgFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex items-center justify-between">
          <Label>Background</Label>
          <div className="flex items-center gap-2">
            {backgroundKind === "image" && backgroundImageId ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => void onRemoveBackground()}
              >
                Remove
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onPickBgFile}
            >
              {backgroundKind === "image" ? "Replace image" : "Choose image"}
            </Button>
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void handleBgFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {bgError ? (
          <div className="rounded-md border border-destructive/(--emph-soft) bg-destructive/(--emph-faint) px-2.5 py-1.5 text-[11.5px] text-destructive">
            {bgError}
          </div>
        ) : null}
        {backgroundKind === "image" && backgroundImageId ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border/(--emph-strong) p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11.5px] text-muted-foreground">Opacity</span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {Math.round(backgroundOpacity * 100)}%
              </span>
            </div>
            <Slider
              value={[backgroundOpacity]}
              min={0}
              max={1}
              step={0.01}
              onValueChange={(v) => void setBackgroundOpacity(v[0] ?? 0)}
            />
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11.5px] text-muted-foreground">Blur</span>
              <span className="tabular-nums text-[11px] text-muted-foreground">
                {backgroundBlur}px
              </span>
            </div>
            <Slider
              value={[backgroundBlur]}
              min={0}
              max={64}
              step={1}
              onValueChange={(v) => void setBackgroundBlur(v[0] ?? 0)}
            />
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Drop an image here or pick one. Stored locally; doesn't affect the
            default look until set.
          </p>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium tracking-tight text-muted-foreground">
      {children}
    </span>
  );
}
```

`listBuiltinThemes` is already exported from the theme barrel (`src/modules/theme/index.ts`).

- [ ] **Step 6: Run everything**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: PASS. If `pnpm lint` reports an unused `openFileTab` or `tabsRef` in `App.tsx`, remove only what is genuinely unused.

- [ ] **Step 7: Commit**

```bash
git add -A src/modules/theme src/modules/editor/lib/useEditorThemeExt.ts src/modules/command-palette/CommandPalette.tsx src/app/App.tsx src/settings/sections/ThemesSection.tsx
git commit -m "refactor(theme): remove custom JSON theme files, themes are builtins"
```

---

### Task 4: One font for the whole app, three font-heavy themes deleted

**Files:**
- Modify: `src/styles/globals.css` (line 4 import, `@theme inline` lines 12-14, `.terra-chrome-label` block)
- Delete: `src/styles/fonts.css`, `src/styles/space-grotesk.css`, `src/styles/pixelify-sans.css`
- Delete: `src/modules/theme/fonts.ts`, `fonts.test.ts`, `resolveTerminalFont.ts`, `resolveTerminalFont.test.ts`
- Delete: `src/modules/theme/themes/stardew.ts`, `windows-xp.ts`, `gameboy.ts`
- Modify: `src/modules/theme/{types,tokens,ThemeProvider,index}.ts(x)`, `src/modules/theme/themes/{index,nothing,rebar}.ts`
- Modify: `src/lib/fonts.ts`, `src/lib/fonts.test.ts`, `src/modules/terminal/lib/useTerminalFont.ts`, `src/modules/editor/lib/extensions.ts:42`, `src/modules/editor/lib/chromeTheme.ts:171,178,197,293,358,372`, `src/settings/sections/GeneralSection.tsx` (FontFamilyInput)
- Modify: `knip.json`, `package.json`, `src/styles/tailwindTokens.test.ts`, `src/styles/surfaceClasses.test.ts`
- Create: `scripts/theme-token-reference-sync.mjs`; add script `theme:sync-tokens` to `package.json`

**Interfaces:**
- Produces: `APP_FONT_FAMILY` and `TERMINAL_FONT_FAMILY` constants in `src/lib/fonts.ts`; `resolveFontFamily(userInput)` unchanged in shape; `useTerminalFont()` returns `{ fontFamily, fontWeight, fontSize }` from preferences only.
- Removes: `type.sans`, `type.mono`, `type.display`, `type.fonts`, `terminal.fontFamily`, `terminal.fontWeight`, `terminal.fontSize` from the theme types and the tokens `--ui-font-sans`, `--ui-font-mono`, `--ui-font-display`.

- [ ] **Step 1: Write the failing font tests**

In `src/lib/fonts.test.ts` change the constant to:

```ts
const FALLBACK =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", monospace';
```

In `src/styles/tailwindTokens.test.ts` replace the test `keeps the wrapped theme tokens falling back to today's values` with:

```ts
  it("pins every face to the app font and keeps spacing themeable", () => {
    expect(GLOBALS).toContain('--font-sans: "JetBrainsMono Nerd Font", monospace');
    expect(GLOBALS).toContain('--font-mono: "JetBrainsMono Nerd Font", monospace');
    expect(GLOBALS).not.toContain("fonts.css");
    expect(GLOBALS).toContain("--spacing: var(--ui-spacing, 0.25rem)");
  });
```

In `src/styles/surfaceClasses.test.ts` delete the line `expect(b).toContain("var(--ui-font-display, inherit)");` from the chrome label test and add `expect(b).not.toContain("font-family");`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/lib/fonts.test.ts src/styles`
Expected: FAIL on the new fallback chain and the font declarations.

- [ ] **Step 3: Rewrite `src/lib/fonts.ts`**

```ts
// One face for the whole app, chosen for reading comfort. The terminal takes
// the Mono variant so every Nerd icon occupies exactly one cell.
export const APP_FONT_FAMILY = '"JetBrainsMono Nerd Font", monospace';
export const TERMINAL_FONT_FAMILY =
  '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", monospace';

let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrainsMono Nerd Font Mono"'),
    document.fonts.load('700 14px "JetBrainsMono Nerd Font Mono"'),
  ]).then(() => undefined);
  return monoReady;
}

export function resolveFontFamily(userInput: string): string {
  const name = userInput.trim();
  if (!name) return TERMINAL_FONT_FAMILY;
  // A comma means the user gave a full stack; otherwise quote the single family.
  const head = name.includes(",") ? name : `"${name.replace(/['"]/g, "")}"`;
  return `${head}, ${TERMINAL_FONT_FAMILY}`;
}
```

Replace every `detectMonoFontFamily()` call with `APP_FONT_FAMILY` in `src/modules/editor/lib/extensions.ts` and `src/modules/editor/lib/chromeTheme.ts`, and change their imports to `import { APP_FONT_FAMILY } from "@/lib/fonts";`. `src/modules/terminal/lib/useTerminalSession.ts:342` keeps calling `ensureMonoFontsLoaded()`.

- [ ] **Step 4: Fonts in CSS**

`src/styles/globals.css`: delete the line `@import "./fonts.css";`. In `@theme inline` replace the three font lines with:

```css
    --font-heading: var(--font-sans);
    --font-sans: "JetBrainsMono Nerd Font", monospace;
    --font-mono: "JetBrainsMono Nerd Font", monospace;
```

In `.terra-chrome-label` delete `font-family: var(--ui-font-display, inherit);`.

```bash
git rm src/styles/fonts.css src/styles/space-grotesk.css src/styles/pixelify-sans.css
pnpm remove @fontsource-variable/inter @fontsource/dotgothic16 @fontsource/jetbrains-mono @fontsource/pixelify-sans @fontsource/press-start-2p @fontsource/space-grotesk @fontsource/vt323
```

In `knip.json` remove the four `@fontsource*` entries from `ignoreDependencies`.

- [ ] **Step 5: Remove the theme font machinery**

```bash
git rm src/modules/theme/fonts.ts src/modules/theme/fonts.test.ts src/modules/theme/resolveTerminalFont.ts src/modules/theme/resolveTerminalFont.test.ts src/modules/theme/themes/stardew.ts src/modules/theme/themes/windows-xp.ts src/modules/theme/themes/gameboy.ts
```

`src/modules/theme/types.ts`: delete `import type { FontId } from "./fonts";`; in `TerminalPalette` delete `fontFamily`, `fontWeight`, `fontSize`; `ThemeTypography` becomes:

```ts
export type ThemeTypography = Partial<{
  chromeTracking: string;
  chromeTransform: TextTransform;
}>;
```

`src/modules/theme/tokens.ts`: delete the three entries `type.sans`, `type.mono`, `type.display`.

`src/modules/theme/ThemeProvider.tsx`: delete `import { loadFonts } from "./fonts";` and reduce the apply effect to:

```ts
  useEffect(() => {
    applyTheme(activeTheme, resolvedMode);
  }, [activeTheme, resolvedMode]);
```

`src/modules/theme/index.ts`: delete the `resolveTerminalFont` export block.

`src/modules/theme/themes/index.ts` becomes:

```ts
import { DEFAULT_THEME_ID, type Theme } from "../types";
import { gruvbox } from "./gruvbox";
import { kanagawa } from "./kanagawa";
import { kanagawaDragon } from "./kanagawa-dragon";
import { nothing } from "./nothing";
import { rebar } from "./rebar";
import { terraDefault } from "./terra-default";

export { terraDefault, kanagawa, kanagawaDragon, gruvbox, nothing, rebar };

export const BUILTIN: readonly Theme[] = [
  terraDefault,
  nothing,
  rebar,
  kanagawa,
  kanagawaDragon,
  gruvbox,
];

const BY_ID = new Map<string, Theme>(BUILTIN.map((t) => [t.id, t]));

export function listBuiltinThemes(): Theme[] {
  return BUILTIN as Theme[];
}

export function getBuiltinTheme(id: string): Theme | undefined {
  return BY_ID.get(id);
}

export function getDefaultTheme(): Theme {
  return BY_ID.get(DEFAULT_THEME_ID) ?? BUILTIN[0];
}
```

`src/modules/theme/themes/nothing.ts`: in both variants delete `fontFamily: "JetBrainsMono Nerd Font",` from `terminal` and reduce `type` to `{ chromeTracking: "0.14em", chromeTransform: "uppercase" }`. Delete the header comment paragraph that begins `// DotGothic16 stays on` (through the line ending `can actually reach.`). The file is rebuilt in Task 9.

`src/modules/theme/themes/rebar.ts`: in both variants delete `fontFamily: "JetBrainsMono Nerd Font",` from `terminal`, and in `type` delete the `sans`, `display`, and `fonts` lines, keeping `chromeTracking` and `chromeTransform`.

- [ ] **Step 6: Terminal font hook and settings copy**

`src/modules/terminal/lib/useTerminalFont.ts` becomes:

```ts
import { usePreferencesStore } from "@/modules/settings/preferences";
import { useMemo } from "react";

export type TerminalFont = {
  fontFamily: string;
  fontWeight: string;
  fontSize: number;
};

export function useTerminalFont(): TerminalFont {
  const fontFamily = usePreferencesStore((p) => p.terminalFontFamily);
  const fontWeight = usePreferencesStore((p) => p.terminalFontWeight);
  const fontSize = usePreferencesStore((p) => p.terminalFontSize);
  return useMemo(
    () => ({ fontFamily, fontWeight, fontSize }),
    [fontFamily, fontWeight, fontSize],
  );
}
```

If `pnpm check-types` shows another file importing `TerminalFont` from `@/modules/theme`, point it at `@/modules/terminal/lib/useTerminalFont`.

`src/settings/sections/GeneralSection.tsx`, in `FontFamilyInput`: the `SettingRow` description becomes `"Terminal face. Leave blank for JetBrainsMono Nerd Font Mono."` and the input `placeholder` becomes `"JetBrainsMono Nerd Font Mono"`.

- [ ] **Step 7: Token reference sync script**

Create `scripts/theme-token-reference-sync.mjs`:

```js
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
```

Add to `package.json` scripts: `"theme:sync-tokens": "node scripts/theme-token-reference-sync.mjs"`. Run `pnpm theme:sync-tokens`; the duplicated markers in `THEME.md` collapse to one pair and the `type` group loses its three font rows.

- [ ] **Step 8: Run everything**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: PASS, including `tokens.test.ts` "keeps the THEME.md token reference in sync".

- [ ] **Step 9: Look at it running**

Every label, the editor, and the terminal render in JetBrainsMono Nerd Font. In a terminal run `echo -e "\ue7a8 \uf07b \ue628"`: three icons, each one cell wide, no overlap. Start Claude Code in a tab and check the TUI borders align.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(theme): render the whole app in JetBrainsMono Nerd Font and drop the theme fonts

Deletes the Stardew, Windows XP, and Game Boy builtins with the bundled faces
they depended on, and adds pnpm theme:sync-tokens for the THEME.md token table."
```

---

### Task 5: Theme file contract

**Files:**
- Modify: `src/modules/theme/types.ts`, `tokens.ts`, `resolveTheme.ts`, `resolveTheme.test.ts`, `resolveEditorTheme.ts`, `resolveEditorTheme.test.ts`, `ThemeProvider.tsx`, `themes/builtins.test.ts`
- Modify: `src/modules/theme/themes/{terra-default,rebar,gruvbox,kanagawa,kanagawa-dragon,nothing}.ts`
- Modify: `src/styles/globals.css`, `src/styles/surfaceClasses.test.ts`, `scripts/theme-token-reference.mjs`, `THEME.md` (generated block)
- Delete: `src/modules/theme/__snapshots__/resolveTheme.test.ts.snap`

**Interfaces:**
- Produces: `ThemeVariant.effects?: ThemeEffects` (`shadow: string`, `blur: "on" | "off"`, `wallpaper: boolean`), `ThemeVariant.icons?: IconSet` (`"catppuccin" | "nerd"`), `ThemeShape.pillRadius`, `TokenDef.map`, and `useTheme().activeVariant: ThemeVariant` (the resolved variant for the active mode). Removes `Theme.editorTheme`, `colors.sidebar*`, `shape.controlWidth`, `shape.liftColor`, `shape.liftDepth`.

- [ ] **Step 1: Write the failing resolver tests**

In `src/modules/theme/resolveTheme.test.ts` replace the imports and the snapshot test:

```ts
import { describe, expect, it } from "vitest";
import { contrast } from "./oklab";
import { resolveTheme } from "./resolveTheme";
import { listBuiltinThemes } from "./themes";
import { STATUS_ROLES, SYNTAX_ROLES, type Theme, type ThemeMode } from "./types";

const MODES: ThemeMode[] = ["light", "dark"];
const get = (vars: readonly (readonly [string, string])[], name: string) =>
  vars.find(([n]) => n === name)?.[1];
const DIM_ROLES = new Set(["comment", "gutterFg", "tagBracket"]);

describe("resolveTheme", () => {
  // Replaces a 7000-line snapshot nobody could review. Every derived colour
  // must clear the floor its derive() promised, on every builtin, both modes.
  it("lifts every derived syntax and status colour to its contrast floor", () => {
    for (const theme of listBuiltinThemes()) {
      for (const mode of MODES) {
        const variant = theme.variants[mode];
        const bg = variant?.colors?.background;
        if (!variant || !bg) continue;
        const vars = resolveTheme(theme, mode) ?? [];
        for (const role of SYNTAX_ROLES) {
          if (variant.syntax?.[role]) continue;
          const v = get(vars, `--syntax-${role}`);
          expect(v, `${theme.id}/${mode} syntax.${role}`).toBeDefined();
          const floor = DIM_ROLES.has(role) ? 3 : 4.5;
          expect(contrast(v as string, bg), `${theme.id}/${mode} syntax.${role}`)
            .toBeGreaterThanOrEqual(floor - 0.01);
        }
        for (const role of STATUS_ROLES) {
          if (variant.status?.[role]) continue;
          const v = get(vars, `--status-${role}`);
          expect(v, `${theme.id}/${mode} status.${role}`).toBeDefined();
          expect(contrast(v as string, bg), `${theme.id}/${mode} status.${role}`)
            .toBeGreaterThanOrEqual(4.49);
        }
      }
    }
  });

  it("maps keyword tokens onto their CSS values", () => {
    const theme: Theme = {
      id: "flat", name: "Flat",
      variants: { dark: {
        colors: { background: "#101010", foreground: "#f0f0f0" },
        effects: { blur: "off", shadow: "transparent" },
        shape: { pillRadius: "2px" },
      } },
    };
    const vars = resolveTheme(theme, "dark") ?? [];
    expect(get(vars, "--fx-blur-factor")).toBe("0");
    expect(get(vars, "--fx-shadow-color")).toBe("transparent");
    expect(get(vars, "--radius-pill")).toBe("2px");
  });

  it("defaults to blur on, no shadow tint, and a round pill", () => {
    const vars = resolveTheme(
      { id: "bare", name: "Bare", variants: { dark: { colors: { background: "#101010" } } } },
      "dark",
    ) ?? [];
    expect(get(vars, "--fx-blur-factor")).toBe("1");
    expect(get(vars, "--fx-shadow-color")).toBeUndefined();
    expect(get(vars, "--radius-pill")).toBe("9999px");
  });
```

Keep the four existing non-snapshot tests below unchanged. Then:

```bash
git rm src/modules/theme/__snapshots__/resolveTheme.test.ts.snap
```

In `src/modules/theme/themes/builtins.test.ts` replace the test `pairs editor themes only for variants that exist` with:

```ts
  it("declares a 16-slot ANSI palette in both variants, the editor derives from it", () => {
    for (const t of builtins) {
      for (const mode of ["light", "dark"] as const) {
        expect(t.variants[mode]?.terminal?.ansi, `${t.id}/${mode}`).toHaveLength(16);
      }
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/modules/theme`
Expected: FAIL. `--fx-blur-factor` and friends are undefined; `check-types` would also fail on `effects`.

- [ ] **Step 3: Types**

`src/modules/theme/types.ts`: in `ThemeColors` delete the eight `sidebar*` keys. In `ThemeShape` delete `controlWidth`, `liftColor`, `liftDepth` and add `pillRadius: string;`. After `ThemeTypography` add:

```ts
export const BLUR_MODES = ["on", "off"] as const;

export type BlurMode = (typeof BLUR_MODES)[number];

/**
 * Ambient effects. `shadow` is the tint every shadow utility uses, so
 * `transparent` flattens the app; `wallpaper: false` declines the user's
 * background image while the theme is active.
 */
export type ThemeEffects = Partial<{
  shadow: string;
  blur: BlurMode;
  wallpaper: boolean;
}>;

export const ICON_SETS = ["catppuccin", "nerd"] as const;

export type IconSet = (typeof ICON_SETS)[number];
```

In `ThemeVariant` add `effects?: ThemeEffects;` and `icons?: IconSet;`. In `Theme` delete the `editorTheme` block.

- [ ] **Step 4: Tokens and the resolver**

`src/modules/theme/tokens.ts`: `TokenDef.group` gains `"effects"`; add to `TokenDef`:

```ts
  /** Rewrites an authored keyword into the CSS value the variable carries. */
  map?: Readonly<Record<string, string>>;
```

Delete the eight `colors.sidebar*` entries and `shape.controlWidth`, `shape.liftColor`, `shape.liftDepth`. After `shape.spacing` add:

```ts
  { key: "shape.pillRadius", cssVar: "--radius-pill", group: "shape", kind: "length", fallback: "9999px", doc: "Radius of pills, chips, toggles, and badges (rounded-pill)." },

  { key: "effects.shadow", cssVar: "--fx-shadow-color", group: "effects", kind: "color", doc: "Tint every shadow utility uses; transparent flattens the app." },
  { key: "effects.blur", cssVar: "--fx-blur-factor", group: "effects", kind: "keyword", keywords: ["on", "off"], map: { on: "1", off: "0" }, fallback: "1", doc: "Backdrop blur: on keeps the scale, off zeroes it." },
```

`src/modules/theme/resolveTheme.ts`, inside `resolveOne`, replace the `authored` line with:

```ts
    const raw = readAuthored(variant, key);
    const authored = raw !== undefined && def.map ? (def.map[raw] ?? raw) : raw;
```

`scripts/theme-token-reference.mjs`: the `groups` array becomes `["colors", "shape", "type", "effects", "terminal", "syntax", "status", "emphasis"]`.

- [ ] **Step 5: Editor pairing without `editorTheme`**

`src/modules/theme/resolveEditorTheme.ts` becomes:

```ts
import {
  EDITOR_THEME_AUTO,
  type EditorThemeId,
  type EditorThemePref,
} from "@/modules/settings/store";
import { resolveVariant } from "./resolveVariant";
import { getBuiltinTheme, getDefaultTheme } from "./themes";

const FALLBACK: Record<"light" | "dark", EditorThemeId> = {
  light: "github-light",
  dark: "atomone",
};

export type EditorThemeResolution =
  | { kind: "derived"; mode: "light" | "dark" }
  | { kind: "preset"; id: EditorThemeId };

/**
 * In "auto" a theme derives its syntax palette from its own ansi colours. Every
 * builtin declares one, so the preset fallback only covers a theme without.
 */
export function resolveEditorTheme(
  pref: EditorThemePref,
  themeId: string,
  mode: "light" | "dark",
): EditorThemeResolution {
  if (pref !== EDITOR_THEME_AUTO) return { kind: "preset", id: pref };
  const theme = getBuiltinTheme(themeId) ?? getDefaultTheme();
  const resolved = resolveVariant(theme, mode);
  if (resolved?.variant.terminal?.ansi) {
    return { kind: "derived", mode: resolved.mode };
  }
  return { kind: "preset", id: FALLBACK[mode] };
}
```

In `src/modules/theme/resolveEditorTheme.test.ts` delete `editorTheme` from every fixture; a case that expected a mapped preset for a theme without `ansi` now expects `FALLBACK[mode]` (`github-light` for light, `atomone` for dark). Cases about an explicit preference and about `ansi` deriving are unchanged.

- [ ] **Step 6: Expose the active variant**

`src/modules/theme/ThemeProvider.tsx`: import `resolveVariant` from `./resolveVariant` and `type ThemeVariant` from `./types`; add `activeVariant: ThemeVariant;` to `ThemeProviderState`; after the `activeTheme` memo add:

```ts
  const activeVariant = useMemo<ThemeVariant>(
    () => resolveVariant(activeTheme, resolvedMode)?.variant ?? {},
    [activeTheme, resolvedMode],
  );
```

and include `activeVariant` in the context value and its dependency array.

- [ ] **Step 7: Builtins and CSS defaults**

```bash
sed -i '/^\s*sidebar[A-Za-z]*: /d' src/modules/theme/themes/terra-default.ts src/modules/theme/themes/rebar.ts src/modules/theme/themes/gruvbox.ts src/modules/theme/themes/kanagawa.ts src/modules/theme/themes/kanagawa-dragon.ts src/modules/theme/themes/nothing.ts
```

Delete the `editorTheme` line in `terra-default.ts`, `gruvbox.ts`, `kanagawa.ts`, `kanagawa-dragon.ts` (one line each) and the four-line `editorTheme: { ... },` block in `rebar.ts` and `nothing.ts`. In `rebar.ts` delete the header comment paragraph that explains `liftColor`/`liftDepth`.

`src/styles/globals.css`:
- In `@theme inline` delete the eight `--color-sidebar*` lines.
- In `:root` and `.dark` delete the eight `--sidebar*` lines each.
- In the `:root` block that holds `--bevel-width` delete `--lift-color: transparent;` and `--lift-depth: 0px;`.
- In `.terra-frame` the `box-shadow` becomes the three inset rings only (drop the `0 var(--lift-depth) 0 var(--lift-color)` line and the comma before it).
- Delete the `.terra-control { ... }` block.

`src/styles/surfaceClasses.test.ts`: remove the `[".terra-control", "--control-border-width"]` row and the `--lift-color` and `--lift-depth` strings from the bevel test.

- [ ] **Step 8: Sync docs and run everything**

Run: `pnpm theme:sync-tokens && pnpm lint && pnpm check-types && pnpm test`
Expected: PASS. If a builtin fails the contrast floor test, the derivation cannot lift that slot on that background: fix the theme's colour (usually the background or the ansi slot), not the test, and say so in the commit.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(theme): add effects, icons, and pill radius to the theme contract, prune dead tokens

Removes the sidebar colours, controlWidth, the lift shadow, and the editorTheme
pairing (every builtin declares ansi, so derivation always won). Replaces the
resolveTheme snapshot with contrast-floor assertions on every derived token."
```

---

### Task 6: Chrome labels wear `terra-label`

**Files:**
- Modify: `src/styles/globals.css` (`.terra-chrome-label` becomes `@utility terra-label`), `src/styles/surfaceClasses.test.ts`, `src/app/theme-contract.test.ts`
- Modify: `src/modules/tabs/TabBar.tsx:456`, `src/modules/sidebar/SidebarRail.tsx:72`, `src/settings/SettingsApp.tsx:145`, `src/components/ui/command.tsx:127`, `src/modules/explorer/FileExplorer.tsx:495`, `src/modules/statusbar/DiagnosticsBadge.tsx:16`, `src/modules/statusbar/StatusBar.tsx:36`, `src/modules/lsp/components/LspStatusPill.tsx:28`, `src/modules/preview/DevServerChip.tsx:29`
- Modify: `src/modules/agents/components/NotificationBell.tsx:316`, `src/modules/spaces/components/SpaceSettingsPopover.tsx:89,110,132,167`, `src/modules/git-history/GitHistoryPane.tsx:540,753,957`, `src/modules/editor/GitDiffPane.tsx:261`, `src/settings/sections/ShortcutsSection.tsx:122`, `src/modules/source-control/SourceControlPanel.tsx:269,298,653,1099`

**Interfaces:**
- Produces: the `terra-label` utility. `letter-spacing` and `text-transform` inherit, so the class on a container styles every text node inside it; a nested `normal-case tracking-normal` resets a child that must stay content.

- [ ] **Step 1: Write the failing tests**

`src/styles/surfaceClasses.test.ts`: replace the chrome label test with:

```ts
  it("gives chrome labels inert typography defaults", () => {
    const b = block("@utility terra-label");
    expect(b).toContain("letter-spacing: var(--chrome-tracking, inherit)");
    expect(b).toContain("text-transform: var(--chrome-transform, none)");
    expect(CSS).not.toContain(".terra-chrome-label");
  });
```

`src/app/theme-contract.test.ts`: add `skip?: RegExp` to `Rule`, and in `scan` skip a rule when `rule.skip?.test(rel)`. Add rules:

```ts
  {
    id: "text-transform-literal",
    pattern: /["'`][^"'`\n]*\b(uppercase|lowercase)\b[^"'`\n]*["'`]/,
    skip: /^src\/modules\/theme\//,
    message: "casing belongs to the theme; put terra-label on the chrome element",
  },
  {
    id: "arbitrary-tracking",
    pattern: /\btracking-\[/,
    message: "arbitrary tracking; chrome uses terra-label, content uses a named step",
  },
```

Add a test:

```ts
  it("keeps the chrome label class on the anchor surfaces", () => {
    for (const rel of [
      "src/modules/tabs/TabBar.tsx",
      "src/modules/sidebar/SidebarRail.tsx",
      "src/settings/SettingsApp.tsx",
      "src/components/ui/command.tsx",
      "src/modules/explorer/FileExplorer.tsx",
      "src/modules/statusbar/DiagnosticsBadge.tsx",
      "src/modules/lsp/components/LspStatusPill.tsx",
    ]) {
      expect(readFileSync(path.resolve(ROOT, rel), "utf8"), rel).toContain("terra-label");
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/styles/surfaceClasses.test.ts src/app/theme-contract.test.ts`
Expected: FAIL with the 14 `uppercase` sites, the arbitrary tracking sites, and the missing anchors.

- [ ] **Step 3: The utility**

In `src/styles/globals.css` delete the `.terra-chrome-label { ... }` block from `@layer components` and, after `@utility rounded-circle`, add:

```css
/* Chrome text (tab titles, rail labels, statusbar chips, panel and menu
 * headings) wears this; content (file names, commits, terminal) never does.
 * A utility rather than a component class so variants can target it. */
@utility terra-label {
  letter-spacing: var(--chrome-tracking, inherit);
  text-transform: var(--chrome-transform, none);
}
```

- [ ] **Step 4: Replace the literals**

Each edit replaces the quoted fragment inside the existing class string:

- `NotificationBell.tsx:316`: `uppercase tracking-wide` becomes `terra-label`.
- `SpaceSettingsPopover.tsx:89`, `:110`, `:132`, `:167`: `uppercase tracking-wide` becomes `terra-label`.
- `GitHistoryPane.tsx:540`: `uppercase tracking-[0.14em]` becomes `terra-label`.
- `GitHistoryPane.tsx:753`: delete `uppercase`; the child `{initials}` becomes `{initials.toUpperCase()}`.
- `GitHistoryPane.tsx:957`: `uppercase tracking-[0.16em]` becomes `terra-label`.
- `GitDiffPane.tsx:261`: `uppercase tracking-wide` becomes `terra-label`.
- `ShortcutsSection.tsx:122`: `tracking-wider text-muted-foreground uppercase` becomes `terra-label text-muted-foreground`.
- `SourceControlPanel.tsx:269` and `:298`: `uppercase tracking-[0.12em]` becomes `terra-label`.
- `SourceControlPanel.tsx:653`: `uppercase tracking-wider` becomes `terra-label`.
- `SourceControlPanel.tsx:1099`: `uppercase tracking-[0.16em]` becomes `terra-label`.

The nested resets at `NotificationBell.tsx:320`, `GitHistoryPane.tsx:959`, and `CommandPalette.tsx:384` (`normal-case tracking-normal`) stay.

- [ ] **Step 5: Add the class to the anchors**

- `TabBar.tsx:456`: `cn("truncate", isPreview && "italic")` becomes `cn("terra-label truncate", isPreview && "italic")`.
- `SidebarRail.tsx:72`: `<span className="truncate">` becomes `<span className="terra-label truncate">`.
- `SettingsApp.tsx:145`: `<span>{t.label}</span>` becomes `<span className="terra-label">{t.label}</span>`.
- `command.tsx:127`: append ` **:[[cmdk-group-heading]]:terra-label` inside the class string.
- `FileExplorer.tsx:495`: `terra-chrome-label` becomes `terra-label`.
- `DiagnosticsBadge.tsx:16`: prepend `terra-label ` to the class string.
- `StatusBar.tsx:36`: prepend `terra-label ` to the private chip's class string.
- `LspStatusPill.tsx:28`: prepend `terra-label ` to `PILL_CLASS`.
- `DevServerChip.tsx:29`: `"flex items-center gap-1.5 font-medium text-foreground"` becomes `"terra-label flex items-center gap-1.5 font-medium text-foreground"`.

- [ ] **Step 6: Run everything**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: PASS.

- [ ] **Step 7: Look at it running**

Terra Default: no visible change (its tracking and transform are unset). Rebar: tab titles, rail labels, statusbar chips, and panel headings are now uppercase and tracked, matching its source-control headings. Nothing: the same, at its own tracking.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(theme): route every chrome label through the terra-label utility"
```

---

### Task 7: Icon seam with a Nerd Font glyph set and a lazy Catppuccin set

**Files:**
- Create: `src/modules/explorer/lib/iconProvider.tsx`, `src/modules/explorer/lib/nerdIcons.ts`, `src/modules/explorer/lib/nerdIcons.test.ts`
- Rename: `src/modules/explorer/lib/iconResolver.ts` to `src/modules/explorer/lib/catppuccinIcons.ts` (plus its test if one exists)
- Modify: `src/modules/explorer/TreeRow.tsx:8,52,63,111,151-157`, `src/modules/explorer/FileExplorer.tsx:37,498-504,598-606`, `src/modules/explorer/ExplorerSearch.tsx:25,232,252-253`, `src/modules/tabs/TabBar.tsx:390-394,638-656`
- Modify: `src/styles/globals.css` (add `.terra-file-icon`), `src/app/eager-budget.test.ts:10`

**Interfaces:**
- Produces:

```ts
export type FileIcon =
  | { kind: "image"; url: string }
  | { kind: "glyph"; char: string; tone: "folder" | "file" }
  | { kind: "none" };
export interface IconProvider {
  file(name: string): FileIcon;
  folder(name: string, open: boolean): FileIcon;
}
export function useIconProvider(): IconProvider;
export function FileIconView(props: {
  icon: FileIcon;
  className?: string;
  onImageError?: ReactEventHandler<HTMLImageElement>;
}): React.JSX.Element;
```

- Consumes: `useTheme().activeVariant.icons` from Task 5.

- [ ] **Step 1: Write the failing provider test**

Create `src/modules/explorer/lib/nerdIcons.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nerdProvider } from "./nerdIcons";

describe("nerd icon provider", () => {
  it("maps a known extension to its glyph", () => {
    expect(nerdProvider.file("main.ts")).toEqual({ kind: "glyph", char: "\ue628", tone: "file" });
  });

  it("walks compound extensions down to the last segment", () => {
    expect(nerdProvider.file("store.test.ts")).toEqual({ kind: "glyph", char: "\ue628", tone: "file" });
  });

  it("prefers a full-name match over the extension", () => {
    expect(nerdProvider.file("package.json").char).toBe("\ue71e");
    expect(nerdProvider.file(".gitignore").char).toBe("\ue702");
  });

  it("falls back to the generic file glyph", () => {
    expect(nerdProvider.file("weird.zzz")).toEqual({ kind: "glyph", char: "\uf15b", tone: "file" });
    expect(nerdProvider.file("LICENSE.unknown").char).toBe("\uf15b");
  });

  it("distinguishes open and closed folders and tones them as folders", () => {
    expect(nerdProvider.folder("src", false)).toEqual({ kind: "glyph", char: "\uf07b", tone: "folder" });
    expect(nerdProvider.folder("src", true)).toEqual({ kind: "glyph", char: "\uf07c", tone: "folder" });
  });
});
```

Add `"@iconify-json/catppuccin"` to `HEAVY` in `src/app/eager-budget.test.ts` and extend its comment with one line: the Catppuccin icon JSON loads only when a theme selects that set.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/modules/explorer src/app/eager-budget.test.ts`
Expected: FAIL. `nerdIcons` does not exist; the eager test reports `@iconify-json/catppuccin <- src/modules/explorer/lib/iconResolver.ts`.

- [ ] **Step 3: Provider types, hook, and view**

Create `src/modules/explorer/lib/iconProvider.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { useTheme } from "@/modules/theme";
import { type ReactEventHandler, useEffect, useState } from "react";
import { nerdProvider } from "./nerdIcons";

export type FileIcon =
  | { kind: "image"; url: string }
  | { kind: "glyph"; char: string; tone: "folder" | "file" }
  | { kind: "none" };

export interface IconProvider {
  file(name: string): FileIcon;
  folder(name: string, open: boolean): FileIcon;
}

const NONE: FileIcon = { kind: "none" };
const PENDING: IconProvider = { file: () => NONE, folder: () => NONE };

// The Catppuccin set is 70 kB of SVG plus its name tables, so it stays out of
// the startup bundle and loads the first time a theme asks for it.
let catppuccin: IconProvider | null = null;
let loading: Promise<IconProvider> | null = null;

function loadCatppuccin(): Promise<IconProvider> {
  if (!loading) {
    loading = import("./catppuccinIcons").then((m) => {
      catppuccin = m.catppuccinProvider;
      return catppuccin;
    });
  }
  return loading;
}

export function useIconProvider(): IconProvider {
  const { activeVariant } = useTheme();
  const set = activeVariant.icons ?? "catppuccin";
  const [, bump] = useState(0);
  useEffect(() => {
    if (set !== "catppuccin" || catppuccin) return;
    let alive = true;
    void loadCatppuccin().then(() => {
      if (alive) bump((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [set]);
  if (set === "nerd") return nerdProvider;
  return catppuccin ?? PENDING;
}

export function FileIconView({
  icon,
  className,
  onImageError,
}: {
  icon: FileIcon;
  className?: string;
  onImageError?: ReactEventHandler<HTMLImageElement>;
}) {
  if (icon.kind === "image") {
    return (
      <img
        src={icon.url}
        alt=""
        className={cn("shrink-0 object-contain", className)}
        onError={onImageError}
      />
    );
  }
  if (icon.kind === "glyph") {
    return (
      <span
        aria-hidden
        className={cn(
          "terra-file-icon shrink-0",
          icon.tone === "folder" && "text-primary",
          className,
        )}
      >
        {icon.char}
      </span>
    );
  }
  return <span className={cn("shrink-0", className)} />;
}
```

- [ ] **Step 4: The Nerd provider**

Create `src/modules/explorer/lib/nerdIcons.ts`:

```ts
import type { FileIcon, IconProvider } from "./iconProvider";

// Codepoints from the Font Awesome, Devicons, and Seti ranges, which Nerd
// Fonts v3 keeps in the BMP. Anything unlisted gets the generic file glyph.
const FOLDER = "\uf07b";
const FOLDER_OPEN = "\uf07c";
const FILE = "\uf15b";
const TEXT = "\uf15c";
const CONFIG = "\ue615";
const LOCK = "\uf023";
const GIT = "\ue702";
const IMAGE = "\uf1c5";
const ARCHIVE = "\uf1c6";
const AUDIO = "\uf1c7";
const VIDEO = "\uf1c8";
const FONT = "\uf031";
const DATABASE = "\uf1c0";
const SHELL = "\ue795";
const JSON_GLYPH = "\ue60b";
const MARKDOWN = "\ue609";
const TYPESCRIPT = "\ue628";
const JAVASCRIPT = "\ue60c";
const REACT = "\ue7ba";

const BY_NAME: Readonly<Record<string, string>> = {
  ".gitignore": GIT,
  ".gitattributes": GIT,
  ".gitmodules": GIT,
  ".editorconfig": CONFIG,
  ".env": CONFIG,
  "package.json": "\ue71e",
  "pnpm-lock.yaml": LOCK,
  "package-lock.json": LOCK,
  "yarn.lock": LOCK,
  "cargo.lock": LOCK,
  "cargo.toml": "\ue7a8",
  dockerfile: "\ue7b0",
  makefile: CONFIG,
  license: TEXT,
  "readme.md": MARKDOWN,
  "biome.json": JSON_GLYPH,
  "tsconfig.json": TYPESCRIPT,
};

const BY_EXT: Readonly<Record<string, string>> = {
  ts: TYPESCRIPT, mts: TYPESCRIPT, cts: TYPESCRIPT, tsx: REACT,
  js: JAVASCRIPT, mjs: JAVASCRIPT, cjs: JAVASCRIPT, jsx: REACT,
  json: JSON_GLYPH, jsonc: JSON_GLYPH, md: MARKDOWN, mdx: MARKDOWN,
  css: "\ue749", scss: "\ue749", html: "\ue736",
  rs: "\ue7a8", py: "\ue73c", go: "\ue627", java: "\ue738",
  c: "\ue61e", h: "\ue61e", cpp: "\ue61d", hpp: "\ue61d",
  vue: "\ue6a0", toml: CONFIG, yaml: "\ue6a8", yml: "\ue6a8",
  ini: CONFIG, conf: CONFIG, lock: LOCK,
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL,
  svg: IMAGE, png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, ico: IMAGE,
  pdf: "\uf1c1", zip: ARCHIVE, gz: ARCHIVE, tar: ARCHIVE, "7z": ARCHIVE,
  mp4: VIDEO, webm: VIDEO, mkv: VIDEO, mp3: AUDIO, wav: AUDIO, ogg: AUDIO,
  ttf: FONT, otf: FONT, woff: FONT, woff2: FONT,
  sql: DATABASE, db: DATABASE, sqlite: DATABASE,
  txt: TEXT, log: TEXT,
};

function extChain(lower: string): string[] {
  const parts = lower.split(".");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(i).join("."));
  return out;
}

function glyph(char: string, tone: "folder" | "file"): FileIcon {
  return { kind: "glyph", char, tone };
}

export const nerdProvider: IconProvider = {
  file(name) {
    const lower = name.toLowerCase();
    const byName = BY_NAME[lower];
    if (byName) return glyph(byName, "file");
    for (const ext of extChain(lower)) {
      const c = BY_EXT[ext];
      if (c) return glyph(c, "file");
    }
    return glyph(FILE, "file");
  },
  folder(_name, open) {
    return glyph(open ? FOLDER_OPEN : FOLDER, "folder");
  },
};
```

- [ ] **Step 5: The Catppuccin provider**

```bash
git mv src/modules/explorer/lib/iconResolver.ts src/modules/explorer/lib/catppuccinIcons.ts
```

If `src/modules/explorer/lib/iconResolver.test.ts` exists, `git mv` it to `catppuccinIcons.test.ts` and update its import. In `catppuccinIcons.ts` change `export function fileIconUrl` and `export function folderIconUrl` to plain `function` declarations, add `import type { IconProvider } from "./iconProvider";` at the top, and append:

```ts
export const catppuccinProvider: IconProvider = {
  file(name) {
    const url = fileIconUrl(name);
    return url ? { kind: "image", url } : { kind: "none" };
  },
  folder(name, open) {
    const url = folderIconUrl(name, open);
    return url ? { kind: "image", url } : { kind: "none" };
  },
};
```

If the renamed test file calls `fileIconUrl` directly, keep those two functions exported; the eager graph is unaffected because only `iconProvider.tsx` imports this module, and it does so dynamically.

- [ ] **Step 6: Consumers**

`src/modules/explorer/TreeRow.tsx`: replace the import at line 8 with `import { FileIconView, useIconProvider } from "./lib/iconProvider";`. Line 52 becomes:

```ts
  const icons = useIconProvider();
  const icon = isDir ? icons.folder(name, isExpanded) : icons.file(name);
```

Lines 62-66 and 110-114 (the `iconUrl ? <img .../> : <span .../>` blocks) each become `<FileIconView icon={icon} className="size-4" />`. Lines 151-157 (the pending-row `<img>`) become:

```tsx
      <FileIconView
        icon={kind === "dir" ? icons.folder("", false) : icons.file("untitled")}
        className="size-4 opacity-70"
      />
```

Move the `useIconProvider()` call above any early `return` so hook order is stable.

`src/modules/explorer/FileExplorer.tsx`: replace the import at line 37 with `import { FileIconView, useIconProvider } from "./lib/iconProvider";`; add `const icons = useIconProvider();` with the component's other hooks. Lines 498-504 become `<FileIconView icon={icons.folder(basename(rootPath), false)} className="mx-1.5 size-[15px]" />` and lines 598-606 become:

```tsx
                    <FileIconView
                      icon={
                        pendingAtRoot.kind === "dir"
                          ? icons.folder("", false)
                          : icons.file("untitled")
                      }
                      className="size-4 opacity-70"
                    />
```

`src/modules/explorer/ExplorerSearch.tsx`: replace the import at line 25 with `import { FileIconView, useIconProvider } from "./lib/iconProvider";`; add `const icons = useIconProvider();` with the component's hooks; line 232 becomes `const icon = hit.is_dir ? null : icons.file(hit.name);` and the `url ? <img .../> : <HugeiconsIcon .../>` block becomes `icon ? <FileIconView icon={icon} className="size-3.5" /> : <HugeiconsIcon ... />` with the existing folder icon props.

`src/modules/tabs/TabBar.tsx`: replace the `fileIconUrl` import with `import { FileIconView, useIconProvider } from "@/modules/explorer/lib/iconProvider";`. In the `TabBar` component body add `const icons = useIconProvider();` next to its other hooks, and replace the `<img src={fileIconUrl(t.title)} className="size-3.5 shrink-0 object-contain" alt="" />` in the language menu with `<FileIconView icon={icons.file(t.title)} className="size-3.5" />`. `TabIcon` becomes:

```tsx
export function TabIcon({ tab }: { tab: Tab }) {
  const agentStatus = useTabAgentStatus(tab);
  const icons = useIconProvider();
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const icon =
      tab.kind === "editor" && tab.overrideLanguage
        ? icons.file(`dummy.${tab.overrideLanguage}`)
        : icons.file(tab.title);
    return (
      <FileIconView
        icon={icon}
        className="size-3.5"
        onImageError={(e) => {
          const img = e.currentTarget;
          if (img.dataset.fallback) return;
          img.dataset.fallback = "1";
          const fallback = icons.file("dummy.txt");
          if (fallback.kind === "image") img.src = fallback.url;
        }}
      />
    );
  }
```

The rest of `TabIcon` (preview and other kinds) is unchanged. If `@/modules/explorer` has a barrel that should expose the provider, add `export { FileIconView, useIconProvider } from "./lib/iconProvider";` there and import from `@/modules/explorer` instead.

`src/styles/globals.css`, after the `.zoom-exempt` rule:

```css
/* Nerd Font file glyph: one cell wide, centred, coloured by the row. */
.terra-file-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-size: 12px;
}
```

- [ ] **Step 7: Run everything**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: PASS, including the eager-budget lock on `@iconify-json/catppuccin`.

- [ ] **Step 8: Look at it running**

Terra Default shows Catppuccin icons after a brief empty gap on the first paint (the set is loading). In the WebKit inspector, set the active variant to `icons: "nerd"` by temporarily editing `terra-default.ts`: the tree shows monochrome glyphs, folders in the primary colour, and editor tabs show the same glyphs. Revert the edit.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(explorer): theme-selected icon set, Nerd Font glyphs or lazily loaded Catppuccin"
```

---

### Task 8: The theme decides whether the wallpaper shows

**Files:**
- Create: `src/modules/theme/wallpaper.ts`, `src/modules/theme/wallpaper.test.ts`
- Modify: `src/modules/theme/SurfaceLayer.tsx:16-25`, `src/modules/theme/ThemeProvider.tsx` (the `<SurfaceLayer />` element), `src/settings/sections/ThemesSection.tsx` (background block)

**Interfaces:**
- Produces: `wallpaperAllowed(theme: Theme, mode: ThemeMode, prefs: { active: boolean }): boolean`. `SurfaceLayer` takes `{ theme: Theme; mode: ThemeMode }` props.

- [ ] **Step 1: Write the failing test**

Create `src/modules/theme/wallpaper.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Theme } from "./types";
import { wallpaperAllowed } from "./wallpaper";

const accepting: Theme = {
  id: "a", name: "A",
  variants: { dark: { colors: { background: "#000" } }, light: { colors: { background: "#fff" } } },
};
const declining: Theme = {
  id: "d", name: "D",
  variants: {
    dark: { colors: { background: "#000" }, effects: { wallpaper: false } },
    light: { colors: { background: "#fff" } },
  },
};

describe("wallpaperAllowed", () => {
  it("is false when the preference is off, whatever the theme says", () => {
    expect(wallpaperAllowed(accepting, "dark", { active: false })).toBe(false);
  });

  it("is true when the preference is on and the theme does not decline", () => {
    expect(wallpaperAllowed(accepting, "dark", { active: true })).toBe(true);
  });

  it("is false when the active variant declines", () => {
    expect(wallpaperAllowed(declining, "dark", { active: true })).toBe(false);
  });

  it("follows the variant that actually renders", () => {
    expect(wallpaperAllowed(declining, "light", { active: true })).toBe(true);
    const darkOnly: Theme = { id: "x", name: "X", variants: { dark: { effects: { wallpaper: false } } } };
    expect(wallpaperAllowed(darkOnly, "light", { active: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/modules/theme/wallpaper.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: The helper**

Create `src/modules/theme/wallpaper.ts`:

```ts
import { resolveVariant } from "./resolveVariant";
import type { Theme, ThemeMode } from "./types";

export function wallpaperAllowed(
  theme: Theme,
  mode: ThemeMode,
  prefs: { active: boolean },
): boolean {
  if (!prefs.active) return false;
  const resolved = resolveVariant(theme, mode);
  return resolved?.variant.effects?.wallpaper !== false;
}
```

- [ ] **Step 4: Wire the layer**

`src/modules/theme/SurfaceLayer.tsx`: import `wallpaperAllowed` from `./wallpaper` and `type { Theme, ThemeMode }` from `./types`. `SurfaceLayer` becomes:

```tsx
export function SurfaceLayer({ theme, mode }: { theme: Theme; mode: ThemeMode }) {
  const [fastPath] = useState(readBgFastPath);
  const storeActive = usePreferencesStore(
    (s) => s.backgroundKind === "image" && !!s.backgroundImageId,
  );
  const hydrated = usePreferencesStore((s) => s.hydrated);
  const active = hydrated ? storeActive : fastPath.active;
  if (!wallpaperAllowed(theme, mode, { active })) return null;
  return <BackgroundImage fastImageId={fastPath.imageId} />;
}
```

`src/modules/theme/ThemeProvider.tsx`: `<SurfaceLayer />` becomes `<SurfaceLayer theme={activeTheme} mode={resolvedMode} />`. The provider's initial `themeId` already comes from localStorage, so the first paint knows the theme and Nothing never flashes the image.

- [ ] **Step 5: Settings copy**

In `src/settings/sections/ThemesSection.tsx` destructure `activeVariant` from `useTheme()` and add `const wallpaperDeclined = activeVariant.effects?.wallpaper === false;`. In the background block, change the condition around the sliders to `backgroundKind === "image" && backgroundImageId && !wallpaperDeclined ? (...sliders...) : wallpaperDeclined ? (<p className="text-[11px] text-muted-foreground">The active theme declines the wallpaper. Your image is kept and shows again under a theme that accepts it.</p>) : (...existing empty-state paragraph...)`. The Choose, Replace, and Remove buttons stay available in every state.

- [ ] **Step 6: Run everything**

Run: `pnpm lint && pnpm check-types && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(theme): let a theme decline the wallpaper"
```

---

### Task 9: Nothing rebuilt, docs, ADR, budgets

**Files:**
- Rewrite: `src/modules/theme/themes/nothing.ts`
- Modify: `src/modules/theme/resolveTheme.test.ts` (acceptance snapshot), `THEME.md`, `TERRA.md:149` and the explorer bullet, `docs/superpowers/specs/2026-09-06-theme-engine-overhaul-design.md`, `eager-budget.json`, `.size-limit.json`
- Create: `docs/adr/0003-theme-consumption-through-scales.md`

- [ ] **Step 1: Rewrite Nothing**

Replace `src/modules/theme/themes/nothing.ts` with:

```ts
import type { Theme } from "../types";

// Nothing OS: a monochrome void, one red signal, dots you can see.
//
// The identity lives in structure, not colour: a 2px dotted frame and dotted
// dividers, square corners and square pills, uppercase tracked chrome labels,
// glyph icons, no wallpaper, no shadow, no blur. Red is the only saturated
// colour on screen. The ansi palette is near-monochrome so the derived editor
// palette stays monochrome too, and `syntax.tag` is pinned off slot 1 so tags
// do not fire the signal in every file. `emphasis.strong` at 100% keeps the
// chrome from drawing its dotted rules at 60% alpha, where the dots vanish.
export const nothing: Theme = {
  id: "nothing",
  name: "Nothing",
  description: "Monochrome void, dotted rules, one red signal.",
  variants: {
    dark: {
      colors: {
        background: "#0a0a0a",
        foreground: "#ededeb",
        card: "#141414",
        cardForeground: "#ededeb",
        popover: "#1a1a1a",
        popoverForeground: "#ededeb",
        primary: "#d63b2e",
        primaryForeground: "#ffffff",
        secondary: "#1a1a1a",
        secondaryForeground: "#ededeb",
        muted: "#141414",
        mutedForeground: "#9a9a96",
        accent: "#1f1f1f",
        accentForeground: "#ededeb",
        destructive: "#d63b2e",
        border: "#6e6e6a",
        input: "#6e6e6a",
        ring: "#d63b2e",
        radius: "2px",
        borderStyle: "dotted",
      },
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "45%",
        medium: "60%",
        strong: "100%",
        bold: "100%",
      },
      terminal: {
        background: "#0a0a0a",
        foreground: "#ededeb",
        cursor: "#d63b2e",
        cursorAccent: "#ffffff",
        selection: "rgba(214, 59, 46, 0.30)",
        ansi: [
          "#1e1e1e", "#e5342a", "#b6b6b3", "#d2cfc7",
          "#909aa2", "#c0b7bc", "#a8afaf", "#e8e8e6",
          "#7a7a76", "#ff5347", "#cfcfcc", "#e9e6dc",
          "#a9afb9", "#d8ced3", "#bfc7c7", "#ffffff",
        ],
      },
      syntax: { tag: "#a8afaf" },
      shape: {
        frameWidth: "2px",
        frameRadius: "2px",
        chromeWidth: "2px",
        panelWidth: "2px",
        pillRadius: "2px",
      },
      type: { chromeTracking: "0.08em", chromeTransform: "uppercase" },
      effects: { shadow: "transparent", blur: "off", wallpaper: false },
      icons: "nerd",
    },
    light: {
      colors: {
        background: "#fafaf9",
        foreground: "#0a0a0a",
        card: "#ffffff",
        cardForeground: "#0a0a0a",
        popover: "#ffffff",
        popoverForeground: "#0a0a0a",
        primary: "#c8342a",
        primaryForeground: "#ffffff",
        secondary: "#f0f0ee",
        secondaryForeground: "#0a0a0a",
        muted: "#f0f0ee",
        mutedForeground: "#5c5c58",
        accent: "#eaeae8",
        accentForeground: "#0a0a0a",
        destructive: "#c8342a",
        border: "#8a8a86",
        input: "#8a8a86",
        ring: "#c8342a",
        radius: "2px",
        borderStyle: "dotted",
      },
      emphasis: {
        faint: "12%",
        subtle: "32%",
        soft: "45%",
        medium: "60%",
        strong: "100%",
        bold: "100%",
      },
      terminal: {
        background: "#fafaf9",
        foreground: "#0a0a0a",
        cursor: "#c8342a",
        cursorAccent: "#ffffff",
        selection: "rgba(200, 52, 42, 0.22)",
        ansi: [
          "#0a0a0a", "#c42419", "#55554f", "#6e6a5c",
          "#4a5058", "#6a5a60", "#56605e", "#2e2e2a",
          "#6e6e68", "#e5342a", "#74746e", "#8a8578",
          "#6a7280", "#8a7a82", "#78827e", "#141414",
        ],
      },
      syntax: { tag: "#56605e" },
      shape: {
        frameWidth: "2px",
        frameRadius: "2px",
        chromeWidth: "2px",
        panelWidth: "2px",
        pillRadius: "2px",
      },
      type: { chromeTracking: "0.08em", chromeTransform: "uppercase" },
      effects: { shadow: "transparent", blur: "off", wallpaper: false },
      icons: "nerd",
    },
  },
};
```

- [ ] **Step 2: Acceptance snapshot**

Append to `describe("resolveTheme", ...)` in `src/modules/theme/resolveTheme.test.ts`:

```ts
  // The one snapshot kept: Nothing dark is the acceptance case for the
  // structural tokens, and at roughly 90 lines it is reviewable.
  it("resolves Nothing dark to its structural identity", () => {
    const nothing = listBuiltinThemes().find((t) => t.id === "nothing");
    expect(nothing).toBeDefined();
    const vars = resolveTheme(nothing as Theme, "dark") ?? [];
    expect(get(vars, "--border-style")).toBe("dotted");
    expect(get(vars, "--frame-border-width")).toBe("2px");
    expect(get(vars, "--radius-pill")).toBe("2px");
    expect(get(vars, "--chrome-transform")).toBe("uppercase");
    expect(get(vars, "--fx-shadow-color")).toBe("transparent");
    expect(get(vars, "--fx-blur-factor")).toBe("0");
    expect(vars).toMatchSnapshot();
  });
```

Run `pnpm vitest run src/modules/theme/resolveTheme.test.ts -u` once to write the snapshot, then read `src/modules/theme/__snapshots__/resolveTheme.test.ts.snap` and confirm it is a single case.

- [ ] **Step 3: THEME.md**

Replace `THEME.md` with the following, then run `pnpm theme:sync-tokens` to fill the token block:

````markdown
# THEME.md

How to author a Terra theme. Read `TERRA.md` first for the wider architecture;
if this file conflicts with it, `TERRA.md` wins.

## The one rule

**A theme sets values and never ships CSS.** It fills CSS variables, picks an
icon set, and says whether it accepts the wallpaper. It never adds a selector,
a stylesheet, or a component change, so a theme cannot break on a component
refactor and a component refactor cannot silently drop a theme's identity.

The other half of the rule is on the components: **chrome reaches the theme
only through the scales and the label utility.** No `rounded-full`, no
`uppercase`, no arbitrary `rounded-[...]`, `shadow-[...]`, `blur-[...]`, or
`tracking-[...]`, no `border-solid`, no palette colour such as `bg-zinc-900`.
`src/app/theme-contract.test.ts` fails on any of them outside its allowlist,
and every allowlist entry names its reason. See ADR 0003.

## Where things live

| Path | What |
|---|---|
| `src/modules/theme/types.ts` | `Theme`, `ThemeVariant`, and the field types |
| `src/modules/theme/tokens.ts` | the token registry: key, CSS variable, derivation, fallback |
| `src/modules/theme/resolveTheme.ts` | authored value, else derived, else fallback |
| `src/modules/theme/applyTheme.ts` | writes the variables onto `<html>` |
| `src/modules/theme/themes/` | one file per builtin, registered in `index.ts` |
| `src/modules/theme/wallpaper.ts` | `wallpaperAllowed`, read by `SurfaceLayer` |
| `src/modules/explorer/lib/iconProvider.tsx` | the icon seam the `icons` field selects |
| `src/styles/globals.css` | defaults, the scale bridges, surface classes, `terra-label` |
| `src/app/theme-contract.test.ts` | the consumption contract |

Themes are TypeScript builtins only. The compiler checks the shape; the tests
below check the colours.

## Minimum viable theme

```ts
import type { Theme } from "../types";

export const myTheme: Theme = {
  id: "my-theme",              // kebab-case, unique, /^[a-z0-9][a-z0-9-]{1,63}$/
  name: "My Theme",
  description: "One line.",
  variants: {
    light: { colors: { /* ... */ }, terminal: { ansi: [/* 16 */] } },
    dark: { colors: { /* ... */ }, terminal: { ansi: [/* 16 */] } },
  },
};
```

Add it to `BUILTIN` in `themes/index.ts`; that order is the order in Settings.
**Define both variants and both ANSI palettes**; `builtins.test.ts` enforces
it. The editor derives its syntax palette from `ansi`, so a theme without one
falls back to a stock CodeMirror preset.

## What a theme can change

The whole app renders in the system JetBrainsMono Nerd Font. Themes do not pick
a face, a weight, or a size; those are reading-comfort choices, not identity.

| Identity | Field | Reaches |
|---|---|---|
| Palette | `colors.*` | every semantic utility (`bg-card`, `text-muted-foreground`, ...) |
| Corner shape | `colors.radius` | `rounded-xs` through `rounded-4xl`, proportionally |
| Pill shape | `shape.pillRadius` | every `rounded-pill` (chips, badges, toggles, thumbs) |
| Rule style | `colors.borderStyle` | every border, divider, and the window frame |
| Rule weight | `shape.frameWidth`, `chromeWidth`, `panelWidth`, `slotWidth` | the surface classes below |
| Bevel | `shape.bevel*` | three inset rings on frame, panel, slot |
| Label voice | `type.chromeTransform`, `type.chromeTracking` | every `terra-label` |
| Depth | `effects.shadow` | the tint of every `shadow-*`; `transparent` flattens |
| Glass | `effects.blur` | `on` keeps every `backdrop-blur-*`, `off` zeroes them |
| Wallpaper | `effects.wallpaper` | `false` declines the user's image |
| Icons | `icons` | `catppuccin` (colour SVGs) or `nerd` (font glyphs in the row colour) |
| Density | `shape.spacing` | every spacing utility; blunt, expect overflow |

Circles are geometry and never follow `pillRadius`: a status dot uses
`rounded-circle`. When you add a round element, ask "would this look wrong as a
square"; if yes it is a circle, otherwise it is a pill.

## Token reference

Every key is optional. Omitting one leaves the default, which is what renders
today. Regenerate this block with `pnpm theme:sync-tokens`;
`tokens.test.ts` fails when it drifts.

<!-- token-reference:start -->
<!-- token-reference:end -->

## Terminal palette

`terminal.ansi` is exactly 16 strings in the standard order:

```
0-7   black red green yellow blue magenta cyan white
8-15  the same eight, bright
```

Rules `terminalLegibility.test.ts` enforces on every builtin:

- No slot may equal the background.
- Blue must differ from cyan, in both rows.
- `foreground` against `background` clears 4.5:1.
- Normal slots 1-7 clear 4.5:1; bright slots 9-15 clear 3:1.
- Slot 8 (`brightBlack`, the comment colour) clears 3:1.
- Slot 0 is exempt from the ratio, not from the equality rule.

Omitting `terminal.background` inherits `colors.background`, so a saturated
canvas becomes a saturated terminal. Keep terminal backgrounds under about 25%
saturation. When a slot has to move, move it with `ensureContrast` from
`oklab.ts`: it walks lightness only, so hue and chroma survive.

## Derived syntax and status colours

`syntax` and `status` derive from `ansi`, lightness-normalized against
`colors.background` (4.5:1, or 3:1 for `comment`, `gutterFg`, `tagBracket`);
status roles are normalized against `card` as well. Declare a role only to pin
it. `resolveTheme.test.ts` asserts every derived value clears its floor on
every builtin. Slots: `comment` 8, `keyword` 5, `string` 2, `number` 3,
`constant` 13, `func` 4, `property` 6, `type` 14, `tag` 1, `attr` 11,
`attrValue` 2, `heading` 4, `link` 6, `invalid` 9, `gutterFg` and
`tagBracket` 8, `variable` and `operator` from `foreground`. Status: `added` 2,
`modified` 3, `deleted` 1, `renamed` 4, `warning` 3, `conflict` 6, `ok` 2.

## Surface classes and the label utility

| Class | Applied to | Reads |
|---|---|---|
| `.terra-frame` | app root | `frameWidth`, `framePadding`, bevel rings |
| `.terra-chrome` | header, statusbar, explorer header | `chromeWidth` |
| `.terra-panel` | explorer | `panelWidth`, bevel rings |
| `.terra-slot` | nothing yet | `slotWidth`, one inner ring |
| `terra-label` | tab titles, rail labels, statusbar chips, panel and menu headings, settings navigation | `chromeTracking`, `chromeTransform` |

Surface classes live in `@layer components`, so a component's own utilities
still win. `--surface-border-width` is registered `inherits: false`; without
that a class on the header would thicken every button inside it. `terra-label`
is a utility so variants can target it (`**:[[cmdk-group-heading]]:terra-label`).
Its two properties inherit, so it goes on the chrome element and reaches every
text node inside; a nested `normal-case tracking-normal` resets a child that is
content. Content never wears it: file names, commit messages, diff text,
terminal, editor, toasts, the breadcrumb path.

The bevel is three stacked inset rings at `bevelWidth`, `2 * bevelWidth`, and
`3 * bevelWidth`; `bevelWidth: "4px"` with three opaque colours paints 12px.

## Design guidance

- Separate surfaces with borders, not value jumps; a themed palette reads better
  when surfaces stay close and the rule does the work.
- `radius: "0rem"` wants `frameRadius: "0px"` and `pillRadius: "2px"` or the
  app is square panels inside a round window with round chips.
- A dotted rule needs 2px and a border colour that clears 3:1; at 1px CSS
  dotted is indistinguishable from a faint solid line. Raise `emphasis.strong`
  so the chrome does not draw that rule at 60% alpha.
- A thick `frameWidth` needs `framePadding`.
- Turning `effects.shadow` transparent removes depth cues; pair it with a
  visible `border` and a `borderStyle` that carries texture.

## Before you ship

```
pnpm test            # builtins, legibility, resolveTheme floors, theme contract
pnpm check-types
pnpm lint
```

- [ ] Both variants, both `ansi` palettes, same colour keys in each
- [ ] Registered in `themes/index.ts`
- [ ] Terminal rules above pass
- [ ] `mutedForeground` clears 4.5:1 against `card` and `background`
- [ ] Looked at it running in both modes, with a menu, a dropdown, the
      command palette, the source control panel, and an editor tab open

## Adding a token

1. `types.ts`: add the key to its field type.
2. `tokens.ts`: add the entry (key, `cssVar`, group, kind, `fallback` or
   `derive`, and `map` for a keyword that becomes a different CSS value).
3. `globals.css`: consume it with `var(--x, <today's value>)` so a theme that
   does not set it renders byte-identical.
4. Tests: `tokens.test.ts` and `surfaceClasses.test.ts` or
   `tailwindTokens.test.ts` assert the mapping and the default.
5. `pnpm theme:sync-tokens`.

A field that is not a CSS variable (`icons`, `effects.wallpaper`) lives on the
variant type and is read by its consumer through `useTheme().activeVariant`.
````

- [ ] **Step 4: TERRA.md**

Replace the `theme/` bullet (line 149) with:

```markdown
- **theme/**: custom theme engine (no `next-themes`). `ThemeProvider` + `applyTheme` write CSS variables; the TypeScript builtins in `themes/` are the only themes. Syntax and status colours derive from each theme's ANSI palette (`resolveTheme.ts` + `oklab.ts`, both pure). The theme owns the scales the chrome resolves through (radius and pill radius, shadow tint, blur factor, border width and style) via the `@theme inline` bridge in `globals.css`, the `terra-label` utility for chrome casing and tracking, the explorer icon set (`icons`: Catppuccin SVGs loaded lazily, or Nerd Font glyphs), and whether the user's wallpaper shows (`effects.wallpaper`, read by `SurfaceLayer` through `wallpaperAllowed`). Components never use `rounded-full`, `uppercase`, arbitrary shape values, or palette colours: `src/app/theme-contract.test.ts` fails on any of them outside its reasoned allowlist (`docs/adr/0003`). The whole app renders in the system JetBrainsMono Nerd Font; themes do not pick a face. **Authoring a theme or adding a theme token: read `THEME.md` first.**
```

In the `explorer/` bullet replace `file tree with Material/Catppuccin icons (\`iconResolver.ts\`)` with `file tree with a theme-selected icon set (\`lib/iconProvider.tsx\`: Catppuccin SVGs loaded on first use, or Nerd Font glyphs)`.

- [ ] **Step 5: ADR 0003**

Create `docs/adr/0003-theme-consumption-through-scales.md`:

```markdown
# 0003. Chrome consumes the theme through scales, never through literals

Status: accepted

## Context

By 2026-09 every Terra theme rendered as the default look with a new palette.
The resolution pipeline was sound: authored values reached CSS variables
untouched. The consumption side was not. The window frame hardcoded `solid`,
dividers were `bg-border` fills with no border style, the chrome label class
was applied to one element while fourteen `uppercase` and twenty-five
`tracking-*` utilities carried their own values, `rounded-full` was a literal,
and blur and shadow had no token at all. Three commits that tried to make the
Nothing theme reach the screen each found another hardcoded spot, because
nothing recorded what the chrome consumed versus what it merely could.

## Decision

The theme owns the scales Tailwind utilities resolve through. `globals.css`
maps `--radius-*`, `--shadow-*`, and `--blur-*` to theme-facing variables with
Tailwind's defaults as fallbacks, re-emits the `border*` width utilities, and
adds `rounded-pill` (theme radius) and `rounded-circle` (geometry). Chrome text
wears the `terra-label` utility for casing and tracking. Dividers are borders.
The explorer icon set and the wallpaper are theme-declared fields read by their
consumers. Components keep plain Tailwind and never use `rounded-full`,
`uppercase`, `lowercase`, arbitrary `rounded-[...]`, `shadow-[...]`,
`blur-[...]`, `tracking-[...]`, explicit `border-<style>`, or a palette colour.
`src/app/theme-contract.test.ts` scans the source tree and fails on any of
these outside an allowlist whose every entry names its reason.

Themes are TypeScript builtins. The custom JSON theme feature was removed; the
compiler and the builtin tests are the gate. The whole app renders in the
system JetBrainsMono Nerd Font; themes do not choose a face.

## Alternatives considered

A role class on every chrome element (explicit, but forty files, hard to test
mechanically, and redundant with what the scales give for free). Handwritten
CSS for the chrome (maximal control, discards shadcn, largest diff, no
enforcement). Re-emitting `rounded-full` with `@utility` (rejected because
Tailwind merges a same-named utility with its own and its declaration wins).

## Consequences

A new theme changes the look without touching a component. A new component is
themeable by construction if it passes the contract test. Scale names carry
theme meaning, so a designer thinks in steps (`shadow-lg`, `rounded-pill`)
rather than pixels. Adding an allowlist entry is a reviewed change named in
the commit message. The eager bundle shrinks by the font CSS, the Catppuccin
JSON, and the custom theme code.
```

- [ ] **Step 6: Spec amendments**

In `docs/superpowers/specs/2026-09-06-theme-engine-overhaul-design.md`:

- In "Consumption contract / Scales": replace the `rounded-full` bullet with: "`rounded-full` is retired. A same-named `@utility` merges with Tailwind's and Tailwind's declaration wins, so pills use a new `rounded-pill` utility (`border-radius: var(--radius-pill, 9999px)`) and the contract test forbids `rounded-full`." Delete the `--tracking-*` bullet and add to the label section: "Named `tracking-*` steps keep Tailwind's values; only arbitrary `tracking-[...]` is forbidden."
- In "Theme file contract": add "`editorTheme` is removed from `Theme` entirely; every kept builtin declares `terminal.ansi`, so the derived path always won."
- In "Labels": replace "statusbar chips and the breadcrumb" with "statusbar chips (the breadcrumb path is content and stays lowercase, as in the reference)".
- In "Dividers": replace "and the enclosing surface's width" with "at the 1 px initial width unless the divider itself carries a surface class".
- In "Order of work": replace the list with the nine task titles of this plan in order.

- [ ] **Step 7: Budgets and the full CI run**

```bash
pnpm lint && pnpm check-types && pnpm test && pnpm build && pnpm size:eager && pnpm knip && pnpm audit --prod && pnpm audit && pnpm size
```

Read the `size:eager` output for `index.html` and `settings.html`. Set each entry in `eager-budget.json` to the measured gzipped KB rounded up to the next multiple of 5. If `pnpm size` reports total client JS more than 100 KB under the 1500 KB limit, lower `.size-limit.json` to the measured value rounded up to the next 50 KB. Record both old and new numbers in the commit message.

- [ ] **Step 8: Look at it running, both windows, all six themes**

Nothing dark against the reference: dotted 2px frame, dotted dividers, uppercase tracked tabs and chips, square chips, round status dots, glyph icons with folders in red, no wallpaper, no shadow, no blur, lowercase breadcrumb path. Switch back to Terra Default: wallpaper returns, Catppuccin icons return, shadows and blur return. Open Settings: the Themes section lists six themes, and under Nothing the background block says the theme declines the wallpaper.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(theme): rebuild Nothing on the structural contract, document it, lower the budgets

eager-budget.json: index <old> -> <new> KB, settings <old> -> <new> KB (fonts,
Catppuccin JSON, and custom theme code left the eager set)."
```

Replace `<old>` and `<new>` with the measured numbers.

---

## Self-review

- Spec coverage: frame style (T1), dividers (T1), scales and pill/circle (T2), contract test (T1, T2, T6), custom theme removal (T3), fonts and three deletions (T4), theme file contract, dead tokens, editorTheme, snapshot replacement (T5), labels (T6), icon seam and eager lock (T7), wallpaper and settings state (T8), Nothing, THEME.md, TERRA.md, ADR, budgets (T9). The spec's "shrink the snapshot" is met by T5 (floors) plus T9 (one acceptance snapshot).
- Type consistency: `FileIcon`, `IconProvider`, `useIconProvider`, `FileIconView` are defined in T7 and used only there. `activeVariant` is added in T5 and consumed in T7 and T8. `wallpaperAllowed` is defined and used in T8. `TokenDef.map` is defined in T5 and used by `effects.blur` in T5. `APP_FONT_FAMILY` and `TERMINAL_FONT_FAMILY` are defined in T4 and used in T4.
- Order: T2's `arbitrary-shape` rule does not include `tracking`; T6 adds `arbitrary-tracking` once the sites are converted. T2's `palette-colour` rule passes because ThemesSection's orange block is deleted in T3, which runs after T2: to keep T2 green on its own, the three `orange-500` utilities on the import message in `ThemesSection.tsx` are replaced in T2 by `border-status-warning/(--emph-soft) bg-status-warning/(--emph-faint) text-status-warning`.
