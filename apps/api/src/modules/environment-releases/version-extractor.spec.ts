import { VersionFileFormat } from '@prisma/client';
import {
  extractVersion,
  inferVersionFileFormat,
} from './version-extractor';

describe('version extractor', () => {
  it.each([
    ['package.json', '{"name":"web","version":"1.4.2"}', VersionFileFormat.JSON, 'version', '1.4.2'],
    ['pyproject.toml', '[project]\nversion = "2.1.0"\n', VersionFileFormat.TOML, 'project.version', '2.1.0'],
    ['pom.xml', '<project><version>3.0.1</version></project>', VersionFileFormat.XML, 'project.version', '3.0.1'],
    ['pubspec.yaml', 'name: mobile\nversion: 4.2.0+17\n', VersionFileFormat.YAML, 'version', '4.2.0+17'],
    ['gradle.properties', 'group=com.example\nversion=5.0.0\n', VersionFileFormat.PROPERTIES, 'version', '5.0.0'],
    ['setup.cfg', '[metadata]\nname = service\nversion = 6.3.1\n', VersionFileFormat.PROPERTIES, 'metadata.version', '6.3.1'],
    ['VERSION', '7.0.0\n', VersionFileFormat.TEXT, undefined, '7.0.0'],
  ])(
    'extracts %s without executing repository code',
    (_path, content, format, selector, expected) => {
      expect(extractVersion(content, format, selector)).toBe(expected);
    },
  );

  it('supports multiple XML property groups by reading the first matching value', () => {
    const xml = '<Project><PropertyGroup><Version>8.1.0</Version></PropertyGroup><PropertyGroup><Version>8.2.0</Version></PropertyGroup></Project>';
    expect(
      extractVersion(xml, VersionFileFormat.XML, 'Project.PropertyGroup.Version'),
    ).toBe('8.1.0');
  });

  it('rejects multiline and oversized text values', () => {
    expect(extractVersion('1.0.0\nunexpected', VersionFileFormat.TEXT)).toBeNull();
    expect(extractVersion('x'.repeat(201), VersionFileFormat.TEXT)).toBeNull();
  });

  it('infers structured formats from common manifest paths', () => {
    expect(inferVersionFileFormat('apps/api/package.json')).toBe(VersionFileFormat.JSON);
    expect(inferVersionFileFormat('service/pyproject.toml')).toBe(VersionFileFormat.TOML);
    expect(inferVersionFileFormat('Api/Api.csproj')).toBe(VersionFileFormat.XML);
    expect(inferVersionFileFormat('deploy/Chart.yaml')).toBe(VersionFileFormat.YAML);
  });
});
