import { palette, themed } from "@/features/theme/theme";

/** Markdown styles that follow the active theme; the library's defaults assume a white page. */
export function markdownStyle() {
  const code = { backgroundColor: themed("#f1f4f9"), color: palette.ink, borderColor: palette.border };
  return {
    body: { color: palette.ink, fontSize: 14, lineHeight: 22 },
    link: { color: palette.blue },
    heading1: { color: palette.ink },
    heading2: { color: palette.ink },
    heading3: { color: palette.ink },
    heading4: { color: palette.ink },
    heading5: { color: palette.ink },
    heading6: { color: palette.ink },
    hr: { backgroundColor: palette.border },
    blockquote: { backgroundColor: themed("#f1f4f9"), borderColor: palette.border },
    code_inline: code,
    code_block: code,
    fence: code,
    table: { borderColor: palette.border },
    tr: { borderColor: palette.border },
    th: { borderColor: palette.border },
    td: { borderColor: palette.border },
  };
}
