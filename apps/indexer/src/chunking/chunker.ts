export interface SourceDocument {
  filePath: string;
  content: string;
}

export interface CodeChunkDraft {
  filePath: string;
  chunkIndex: number;
  content: string;
  symbol: string | null;
  selectors: string[];
  routes: string[];
}

export interface ChunkingOptions {
  targetCharacters?: number;
  overlapCharacters?: number;
}

const BOUNDARY = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\(|def|func|public\s+(?:class|interface)|private\s+|protected\s+)/;
const SYMBOL_PATTERNS = [
  /\b(?:function|class|interface|type|enum|def|func)\s+([A-Za-z_$][\w$]*)/,
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=/,
  /\b(?:public|private|protected)\s+(?:static\s+)?(?:async\s+)?[A-Za-z_$][\w$<>,[\]? ]*\s+([A-Za-z_$][\w$]*)\s*\(/,
];

export function chunkDocuments(
  documents: SourceDocument[],
  options: ChunkingOptions = {},
): CodeChunkDraft[] {
  const target = options.targetCharacters ?? 2_000;
  const overlap = Math.min(options.overlapCharacters ?? 200, Math.floor(target / 2));
  if (target < 200) throw new Error('Chunk target must be at least 200 characters');

  return documents
    .slice()
    .sort((left, right) => left.filePath.localeCompare(right.filePath))
    .flatMap((document) => chunkDocument(document, target, overlap));
}

function chunkDocument(
  document: SourceDocument,
  target: number,
  overlap: number,
): CodeChunkDraft[] {
  const normalized = document.content.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const sections = languageSections(normalized);
  const contents: string[] = [];
  let pending = '';

  for (const section of sections) {
    if (section.length > target) {
      if (pending) {
        contents.push(pending.trim());
        pending = '';
      }
      contents.push(...windowText(section, target, overlap));
      continue;
    }
    const combined = pending ? `${pending}\n${section}` : section;
    if (combined.length > target && pending) {
      contents.push(pending.trim());
      const tail = overlapTail(pending, overlap);
      pending = tail ? `${tail}\n${section}` : section;
    } else {
      pending = combined;
    }
  }
  if (pending.trim()) contents.push(pending.trim());

  return contents.map((content, chunkIndex) => ({
    filePath: document.filePath,
    chunkIndex,
    content,
    symbol: extractSymbol(content),
    selectors: extractSelectors(content),
    routes: extractRoutes(content),
  }));
}

function languageSections(content: string): string[] {
  const lines = content.split('\n');
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (BOUNDARY.test(line) && current.some((value) => value.trim())) {
      sections.push(current.join('\n').trim());
      current = [];
    }
    current.push(line);
  }
  if (current.some((value) => value.trim())) sections.push(current.join('\n').trim());
  return sections;
}

function windowText(content: string, target: number, overlap: number): string[] {
  const windows: string[] = [];
  let start = 0;
  while (start < content.length) {
    let end = Math.min(start + target, content.length);
    if (end < content.length) {
      const newline = content.lastIndexOf('\n', end);
      if (newline > start + Math.floor(target / 2)) end = newline;
    }
    windows.push(content.slice(start, end).trim());
    if (end >= content.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return windows.filter(Boolean);
}

function overlapTail(content: string, overlap: number): string {
  if (overlap <= 0) return '';
  const start = Math.max(0, content.length - overlap);
  const newline = content.indexOf('\n', start);
  return content.slice(newline >= 0 ? newline + 1 : start).trim();
}

function extractSymbol(content: string): string | null {
  for (const pattern of SYMBOL_PATTERNS) {
    const match = pattern.exec(content);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractSelectors(content: string): string[] {
  const values = new Set<string>();
  collect(content, /\b(data-(?:testid|test|cy|qa))\s*=\s*["'`]([^"'`]+)["'`]/g, (match) =>
    `${match[1]}=${match[2]}`, values);
  collect(content, /\b(?:id|name|aria-label)\s*=\s*["'`]([^"'`]+)["'`]/g, (match) =>
    `${match[0].split('=')[0].trim()}=${match[1]}`, values);
  collect(content, /\bgetByRole\(\s*["'`]([^"'`]+)["'`](?:\s*,\s*\{\s*name:\s*["'`]([^"'`]+)["'`])?/g,
    (match) => `role=${match[1]}${match[2] ? `;name=${match[2]}` : ''}`, values);
  return [...values].sort();
}

function extractRoutes(content: string): string[] {
  const values = new Set<string>();
  collect(content, /["'`]((?:\/api)?\/[A-Za-z0-9_:@*?&=+./${}-]+)["'`]/g, (match) =>
    match[1], values);
  return [...values]
    .filter((value) => value.length > 1 && !value.startsWith('//'))
    .sort();
}

function collect(
  content: string,
  pattern: RegExp,
  value: (match: RegExpExecArray) => string,
  target: Set<string>,
): void {
  let match = pattern.exec(content);
  while (match) {
    target.add(value(match));
    match = pattern.exec(content);
  }
}
