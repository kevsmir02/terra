export function parseSubject(subject: string): {
  type: string;
  scope: string | null;
  breaking: boolean;
  summary: string;
} | null;

export function renderChangelog(
  version: string,
  date: string,
  commits: { hash: string; subject: string }[],
): string;
