import { createHash } from 'node:crypto';

export interface Section {
  slug: string;
  title: string;
  level: number; // 1-6, from heading depth
  lineStart: number; // line index of the heading itself
  lineEnd: number; // exclusive — first line of the next same-or-higher heading, or EOF
}

/**
 * GitHub-style heading slugifier — lowercase, spaces→hyphens, strip non-alphanum.
 * Suffixes duplicates with -1, -2, ... so each section has a stable unique id.
 */
export function slugify(title: string, seen: Map<string, number>): string {
  const base = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safe = base || 'section';
  const count = seen.get(safe) ?? 0;
  seen.set(safe, count + 1);
  return count === 0 ? safe : `${safe}-${count}`;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

/** Scan markdown and return all headings as Sections with stable slugs. */
export function listSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const seen = new Map<string, number>();
  const heads: { level: number; title: string; slug: string; line: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (!m) continue;
    const level = m[1].length;
    const title = m[2].trim();
    heads.push({ level, title, slug: slugify(title, seen), line: i });
  }

  const sections: Section[] = heads.map((h, idx) => {
    // Section ends at the next heading of the same or higher level (lower number = higher).
    let end = lines.length;
    for (let j = idx + 1; j < heads.length; j++) {
      if (heads[j].level <= h.level) { end = heads[j].line; break; }
    }
    return { slug: h.slug, title: h.title, level: h.level, lineStart: h.line, lineEnd: end };
  });
  return sections;
}

/**
 * Return the markdown content of a section by slug, NOT including the heading
 * line itself (so it can stand alone as the test's description). Returns the
 * full markdown if slug is null/empty. Returns null if slug not found.
 */
export function sliceSection(markdown: string, slug: string | null): string | null {
  if (!slug) return markdown.trim();
  const sections = listSections(markdown);
  const match = sections.find((s) => s.slug === slug);
  if (!match) return null;
  const lines = markdown.split('\n');
  return lines.slice(match.lineStart + 1, match.lineEnd).join('\n').trim();
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ─── Item-level anchoring inside a section ───────────────────────────────────

export interface SectionItem {
  index: number; // 1-based ordinal within the section
  title: string; // first-line text, stripped of leading list marker
  marker: 'ordered' | 'unordered';
  fingerprint: string; // stable id derived from normalized title
  preview: string; // up to ~120 chars of content beyond the title for picker UI
  content: string; // full slice: title + nested lines, ready to use as a test description
}

const NUMBERED_RE = /^(\d+)\.\s+(.+)$/;
const BULLET_RE = /^([*\-+])\s+(.+)$/;

/**
 * Stable fingerprint for an item — normalized first-line text, hashed.
 * Lowercase + strip punctuation + collapse whitespace + cap at 60 chars before
 * hashing so trivial edits (extra space, punctuation) don't break the link.
 */
export function itemFingerprint(title: string): string {
  const norm = title
    .toLowerCase()
    .replace(/~~/g, '') // strip strikethrough markers — ClickUp uses these for "deleted"
    .replace(/\*\*/g, '') // strip bold markers
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return createHash('sha256').update(norm).digest('hex').slice(0, 12);
}

/**
 * Find the top-level list items (numbered OR bulleted) inside a section.
 * Returns an empty array if the section has no list structure — caller should
 * treat that as "section has no items, only whole-section linking applies".
 */
export function listSectionItems(markdown: string, sectionSlug: string | null): SectionItem[] {
  const sectionContent = sliceSection(markdown, sectionSlug);
  if (!sectionContent) return [];
  const lines = sectionContent.split('\n');

  // Scan for top-level items (column 0 — no leading whitespace).
  const heads: { start: number; marker: 'ordered' | 'unordered'; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue; // indented — nested under a parent item

    const num = line.match(NUMBERED_RE);
    if (num) {
      heads.push({ start: i, marker: 'ordered', title: num[2].trim() });
      continue;
    }
    const bul = line.match(BULLET_RE);
    if (bul) {
      heads.push({ start: i, marker: 'unordered', title: bul[2].trim() });
    }
  }

  return heads.map((h, idx) => {
    const end = idx + 1 < heads.length ? heads[idx + 1].start : lines.length;
    const content = lines.slice(h.start, end).join('\n').trim();
    const previewBody = lines.slice(h.start + 1, end).join(' ').replace(/\s+/g, ' ').trim();
    return {
      index: idx + 1,
      title: h.title,
      marker: h.marker,
      fingerprint: itemFingerprint(h.title),
      preview: previewBody.length > 120 ? `${previewBody.slice(0, 117)}…` : previewBody,
      content,
    };
  });
}

/** Find an item by fingerprint and return its full content (title + nested). */
export function sliceItem(markdown: string, sectionSlug: string | null, fingerprint: string): string | null {
  const items = listSectionItems(markdown, sectionSlug);
  const match = items.find((i) => i.fingerprint === fingerprint);
  return match ? match.content : null;
}
