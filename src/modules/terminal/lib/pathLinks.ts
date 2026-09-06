import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { terminalLinkDeps } from "./linkDeps";

export type PathLink = {
  /** 0-based [start, end) offsets in the line text, suffix included. */
  start: number;
  end: number;
  path: string;
  line?: number;
  column?: number;
};

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const TOKEN_RE = /(?:~\/|\.{1,2}\/|\/)?(?:[\w.@%+-]+\/)*[\w@%+-][\w.@%+-]*/g;
const EXT_RE = /\.[A-Za-z]\w{0,7}$/;
const TRAILING_RE = /[.,;:'"\])]+$/;
// path:line:col, path(line,col) from tsc, and the python traceback form.
const SUFFIX_RE = /^(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\)|", line (\d+))/;
const MAX_LINKS = 8;

// Path-shaped tokens on one line of terminal output. Anything without a slash
// or an extension is prose, a directory is skipped, and a URL is left to the
// web-links addon. Whether a token is a real file is decided by the caller.
export function findPathLinks(text: string): PathLink[] {
  const scan = text.replace(URL_RE, (url) => " ".repeat(url.length));
  const links: PathLink[] = [];
  for (const match of scan.matchAll(TOKEN_RE)) {
    if (links.length >= MAX_LINKS) break;
    let token = match[0];
    const start = match.index ?? 0;
    let end = start + token.length;
    let line: number | undefined;
    let column: number | undefined;
    const suffix = SUFFIX_RE.exec(scan.slice(end));
    if (suffix) {
      line = Number(suffix[1] ?? suffix[3] ?? suffix[5]);
      const col = suffix[2] ?? suffix[4];
      column = col === undefined ? undefined : Number(col);
      end += suffix[0].length;
    } else {
      const trimmed = token.replace(TRAILING_RE, "");
      end -= token.length - trimmed.length;
      token = trimmed;
    }
    if (!token || scan[end] === "/") continue;
    if (!token.includes("/") && !EXT_RE.test(token)) continue;
    links.push({ start, end, path: token, line, column });
  }
  return links;
}

export function resolveLinkPath(
  path: string,
  cwd: string | undefined,
  home: string | null,
): string | null {
  let full: string;
  if (path.startsWith("/")) full = path;
  else if (path.startsWith("~/")) {
    if (!home) return null;
    full = `${home}/${path.slice(2)}`;
  } else {
    if (!cwd) return null;
    full = `${cwd}/${path}`;
  }
  const out: string[] = [];
  for (const segment of full.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`;
}

const STAT_TTL_MS = 10_000;
const STAT_CACHE_MAX = 256;
const statCache = new Map<string, { at: number; result: Promise<boolean> }>();

function fileExists(path: string): Promise<boolean> {
  const now = Date.now();
  const hit = statCache.get(path);
  if (hit && now - hit.at < STAT_TTL_MS) return hit.result;
  if (statCache.size >= STAT_CACHE_MAX) statCache.clear();
  const current = terminalLinkDeps();
  const result = current
    ? current.exists(path).catch(() => false)
    : Promise.resolve(false);
  statCache.set(path, { at: now, result });
  return result;
}

// Runs only for the line under the pointer, so idle output costs nothing.
export function createPathLinkProvider(
  term: Terminal,
  leafId: () => number | null,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const current = terminalLinkDeps();
      const leaf = leafId();
      const bufferLine = term.buffer.active.getLine(y - 1);
      if (!current || leaf === null || !bufferLine) {
        callback(undefined);
        return;
      }
      const text = bufferLine.translateToString(true);
      const candidates = findPathLinks(text);
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }
      const cwd = current.cwdForLeaf(leaf);
      const home = current.home();
      void Promise.all(
        candidates.map(async (candidate): Promise<ILink | null> => {
          const full = resolveLinkPath(candidate.path, cwd, home);
          if (!full || !(await fileExists(full))) return null;
          return {
            range: {
              start: { x: candidate.start + 1, y },
              end: { x: candidate.end, y },
            },
            text: text.slice(candidate.start, candidate.end),
            activate: () => current.open(full, candidate.line, candidate.column),
          };
        }),
      ).then((links) => {
        const found = links.filter((link): link is ILink => link !== null);
        callback(found.length > 0 ? found : undefined);
      });
    },
  };
}
