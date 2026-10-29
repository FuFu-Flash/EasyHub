/** A short plain-text preview of release notes; Markdown tables and rules are skipped because they read as noise once flattened. */
export function releaseSummary(markdown: string | null | undefined): string {
  const prose = (markdown || "")
    .split(/\r?\n/u)
    .filter((line) => !/^\s*\|/u.test(line) && !/^\s*(?:[-*_]\s*){3,}$/u.test(line) && !/^\s*[-:| ]+$/u.test(line))
    .join("\n");
  return prose
    .replace(/!?(\[([^\]]+)\])\([^)]+\)/gu, "$2")
    .replace(/^[\s>*#-]+/gmu, "")
    .replace(/[*_`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 220);
}
