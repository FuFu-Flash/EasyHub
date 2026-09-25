import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

export interface MarkdownParagraph { key: string; source: string; hasProse: boolean }
export interface MarkdownParagraphs { paragraphs: MarkdownParagraph[]; definitions: string; linkedNames: string[] }

const parser = unified().use(remarkParse).use(remarkGfm);

export function splitMarkdownParagraphs(markdown: string): MarkdownParagraphs {
  const tree = parser.parse(markdown) as MarkdownNode;
  const definitions: string[] = [];
  const paragraphs: MarkdownParagraph[] = [];
  const names = new Set<string>();
  const visit = (node: MarkdownNode): boolean => {
    if ((node.type === 'link' || node.type === 'definition') && node.url) {
      try {
        const url = new URL(node.url);
        const [owner, repo] = url.pathname.split('/').filter(Boolean);
        if (url.hostname.toLowerCase() === 'github.com' && owner && repo) {
          const project = repo.replace(/\.git$/iu, '');
          names.add(owner); names.add(project); names.add(`${owner}/${project}`);
          if (/[-_.]/u.test(project)) names.add(project.replace(/[-_.]+/gu, ' '));
        }
      } catch { /* Relative links have no project metadata. */ }
    }
    let hasProse = node.type === 'text' && Boolean(node.value && /\p{L}/u.test(node.value));
    for (const child of node.children ?? []) if (visit(child)) hasProse = true;
    return hasProse;
  };
  for (const node of tree.children ?? []) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return { paragraphs: [{ key: 'whole', source: markdown, hasProse: true }], definitions: '', linkedNames: [] };
    const source = markdown.slice(start, end);
    if (node.type === 'definition') { definitions.push(source); visit(node); continue; }
    paragraphs.push({ key: `${start}-${end}`, source, hasProse: visit(node) });
  }
  return { paragraphs, definitions: definitions.join('\n'), linkedNames: [...names] };
}
