// A fence opener per CommonMark: up to three spaces, three or more backticks
// or tildes, then the info string, whose first word must be exactly "mermaid".
const FENCE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*mermaid(?![\w-])/im;

export function hasMermaidFence(markdown: string): boolean {
  return FENCE.test(markdown);
}
