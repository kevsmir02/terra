export function renderTokenReference(tokens) {
  const groups = ["colors", "shape", "type", "effects", "terminal", "syntax", "status", "emphasis"];
  let out = "<!-- token-reference:start -->\n";
  
  for (const group of groups) {
    const groupTokens = tokens.filter(t => t.group === group);
    if (groupTokens.length === 0) continue;
    
    out += `\n### \`${group}\`\n\n`;
    out += `| Key | Variable | Default | Doc |\n`;
    out += `|---|---|---|---|\n`;
    
    for (const t of groupTokens) {
      const def = t.fallback ? `\`${t.fallback}\`` : "";
      out += `| \`${t.key}\` | \`${t.cssVar}\` | ${def} | ${t.doc} |\n`;
    }
  }
  
  out += "\n<!-- token-reference:end -->";
  return out;
}
