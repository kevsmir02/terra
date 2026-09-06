import type { ILinkProvider, Terminal } from "@xterm/xterm";

export type TerminalLinkDeps = {
  cwdForLeaf: (leafId: number) => string | undefined;
  home: () => string | null;
  exists: (path: string) => Promise<boolean>;
  open: (path: string, line?: number, column?: number) => void;
};

let deps: TerminalLinkDeps | null = null;

export function configureTerminalLinks(next: TerminalLinkDeps | null): void {
  deps = next;
}

export function terminalLinkDeps(): TerminalLinkDeps | null {
  return deps;
}

// The matcher and its stat cache load on the first hovered line, so a
// terminal that is never hovered never pays for them.
export function lazyPathLinkProvider(
  term: Terminal,
  leafId: () => number | null,
): ILinkProvider {
  let real: Promise<ILinkProvider> | null = null;
  return {
    provideLinks(y, callback) {
      if (!deps) {
        callback(undefined);
        return;
      }
      real ??= import("./pathLinks").then((m) =>
        m.createPathLinkProvider(term, leafId),
      );
      real
        .then((provider) => provider.provideLinks(y, callback))
        .catch(() => callback(undefined));
    },
  };
}
