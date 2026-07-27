import { VersionFileFormat } from '@prisma/client';
import { XMLParser } from 'fast-xml-parser';
import * as TOML from '@iarna/toml';
import { parse as parseYaml } from 'yaml';

export interface VersionManifestCandidate {
  path: string;
  format: VersionFileFormat;
  selectors: string[];
}

export const AUTO_VERSION_MANIFESTS: VersionManifestCandidate[] = [
  { path: 'package.json', format: VersionFileFormat.JSON, selectors: ['version'] },
  { path: 'pyproject.toml', format: VersionFileFormat.TOML, selectors: ['project.version', 'tool.poetry.version'] },
  { path: 'setup.cfg', format: VersionFileFormat.PROPERTIES, selectors: ['metadata.version'] },
  { path: 'pom.xml', format: VersionFileFormat.XML, selectors: ['project.version'] },
  { path: 'gradle.properties', format: VersionFileFormat.PROPERTIES, selectors: ['version'] },
  { path: 'Directory.Build.props', format: VersionFileFormat.XML, selectors: ['Project.PropertyGroup.Version', 'Project.PropertyGroup.VersionPrefix'] },
  { path: 'Cargo.toml', format: VersionFileFormat.TOML, selectors: ['package.version'] },
  { path: 'composer.json', format: VersionFileFormat.JSON, selectors: ['version'] },
  { path: 'pubspec.yaml', format: VersionFileFormat.YAML, selectors: ['version'] },
  { path: 'Chart.yaml', format: VersionFileFormat.YAML, selectors: ['appVersion', 'version'] },
  { path: 'VERSION', format: VersionFileFormat.TEXT, selectors: [] },
  { path: 'version.txt', format: VersionFileFormat.TEXT, selectors: [] },
];

export function inferVersionFileFormat(path: string): VersionFileFormat {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name.endsWith('.json')) return VersionFileFormat.JSON;
  if (name.endsWith('.toml')) return VersionFileFormat.TOML;
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return VersionFileFormat.YAML;
  if (name.endsWith('.xml') || name.endsWith('.csproj') || name.endsWith('.props')) {
    return VersionFileFormat.XML;
  }
  if (name.endsWith('.properties') || name.endsWith('.cfg') || name.endsWith('.ini')) {
    return VersionFileFormat.PROPERTIES;
  }
  return VersionFileFormat.TEXT;
}

export function extractVersion(
  content: string,
  format: VersionFileFormat,
  selector?: string,
): string | null {
  const effectiveFormat = format === VersionFileFormat.AUTO
    ? VersionFileFormat.TEXT
    : format;
  if (effectiveFormat === VersionFileFormat.TEXT) {
    return extractText(content, selector);
  }

  const parsed = parseStructured(content, effectiveFormat);
  const value = selector ? selectValue(parsed, selector) : parsed;
  return normalizeVersion(value);
}

function parseStructured(content: string, format: VersionFileFormat): unknown {
  switch (format) {
    case VersionFileFormat.JSON:
      return JSON.parse(content) as unknown;
    case VersionFileFormat.TOML:
      return TOML.parse(content);
    case VersionFileFormat.YAML:
      return parseYaml(content) as unknown;
    case VersionFileFormat.XML:
      return new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@',
        parseTagValue: false,
        trimValues: true,
      }).parse(content) as unknown;
    case VersionFileFormat.PROPERTIES:
      return parseProperties(content);
    default:
      return content;
  }
}

function parseProperties(content: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current = root;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const section = line.match(/^\[([^\]]+)\]$/u);
    if (section?.[1]) {
      const sectionName = section[1].trim();
      const existing = root[sectionName];
      current = isRecord(existing) ? existing : {};
      root[sectionName] = current;
      continue;
    }
    const separator = line.search(/[=:]/u);
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    current[key] = value;
  }
  return root;
}

function extractText(content: string, selector?: string): string | null {
  if (!selector) return normalizeVersion(content.trim());
  const wanted = selector.trim().toLowerCase();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const separator = line.search(/[=:]/u);
    if (separator < 1) continue;
    if (line.slice(0, separator).trim().toLowerCase() === wanted) {
      return normalizeVersion(line.slice(separator + 1).trim());
    }
  }
  return null;
}

function selectValue(value: unknown, selector: string): unknown {
  let current = value;
  for (const segment of selector.split('.').filter(Boolean)) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
    if (Array.isArray(current)) current = current[0];
  }
  return current;
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 200 || /[\r\n\0]/u.test(normalized)) return null;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
