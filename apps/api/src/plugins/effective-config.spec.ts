import * as fc from 'fast-check';
import { effectiveConfig } from './effective-config';

describe('effectiveConfig', () => {
  describe('basic semantics', () => {
    it('returns defaults when no overrides given', () => {
      expect(effectiveConfig({ a: 1, b: 'x' }, null, null, null)).toEqual({ a: 1, b: 'x' });
    });

    it('most-specific layer wins for primitives', () => {
      const eff = effectiveConfig<{ a: string }>(
        { a: 'feature' },
        { a: 'module' },
        { a: 'project' },
        { a: 'default' },
      );
      expect(eff.a).toEqual('feature');
    });

    it('null at a layer means inherit from below', () => {
      const eff = effectiveConfig<{ a: string }>(
        { a: null as unknown as string },
        { a: 'module' },
        { a: 'project' },
        { a: 'default' },
      );
      expect(eff.a).toEqual('module');
    });

    it('undefined at a layer means inherit from below', () => {
      const eff = effectiveConfig<{ a: string }>(
        { a: undefined as unknown as string },
        { a: 'module' },
        { a: 'project' },
        { a: 'default' },
      );
      expect(eff.a).toEqual('module');
    });

    it('omitting the key entirely also inherits from below', () => {
      const eff = effectiveConfig<{ a: string; b: string }>(
        { b: 'feature-b' },
        { a: 'module-a', b: 'module-b' },
      );
      expect(eff).toEqual({ a: 'module-a', b: 'feature-b' });
    });
  });

  describe('arrays replace', () => {
    it('feature-level array fully replaces module-level array', () => {
      const eff = effectiveConfig<{ tags: string[] }>(
        { tags: ['x', 'y'] },
        { tags: ['a', 'b', 'c'] },
      );
      expect(eff.tags).toEqual(['x', 'y']);
    });

    it('empty array replaces (does not inherit)', () => {
      const eff = effectiveConfig<{ tags: string[] }>(
        { tags: [] },
        { tags: ['a', 'b'] },
      );
      expect(eff.tags).toEqual([]);
    });

    it('null on an array key still inherits', () => {
      const eff = effectiveConfig<{ tags: string[] }>(
        { tags: null as unknown as string[] },
        { tags: ['a'] },
      );
      expect(eff.tags).toEqual(['a']);
    });
  });

  describe('nested objects deep-merge', () => {
    it('only overridden nested keys change; siblings preserved', () => {
      const eff = effectiveConfig<{ ui: { theme: string; density: string } }>(
        { ui: { theme: 'dark' } as { theme: string; density: string } },
        { ui: { theme: 'light', density: 'comfy' } },
      );
      expect(eff.ui).toEqual({ theme: 'dark', density: 'comfy' });
    });

    it('three-deep merge picks closest non-null at each leaf', () => {
      const eff = effectiveConfig<{ a: { b: { c: string; d: string } } }>(
        { a: { b: { c: 'feat' } as { c: string; d: string } } },
        { a: { b: { d: 'mod' } as { c: string; d: string } } },
        { a: { b: { c: 'proj', d: 'proj' } } },
      );
      expect(eff.a.b).toEqual({ c: 'feat', d: 'mod' });
    });

    it('object overrides primitive at the same key', () => {
      const eff = effectiveConfig<{ a: unknown }>(
        { a: { nested: true } },
        { a: 'string' as unknown },
      );
      expect(eff.a).toEqual({ nested: true });
    });
  });

  describe('immutability', () => {
    it('does not mutate any input layer', () => {
      const feature = { a: 'feat' };
      const module = { a: 'mod', b: 'mod' };
      const project = { a: 'proj', b: 'proj', c: 'proj' };
      const featSnap = JSON.stringify(feature);
      const modSnap = JSON.stringify(module);
      const projSnap = JSON.stringify(project);
      effectiveConfig<Record<string, string>>(feature, module, project);
      expect(JSON.stringify(feature)).toBe(featSnap);
      expect(JSON.stringify(module)).toBe(modSnap);
      expect(JSON.stringify(project)).toBe(projSnap);
    });

    it('returned arrays are new instances (not aliasing the input)', () => {
      const tags = ['a', 'b'];
      const eff = effectiveConfig<{ tags: string[] }>({ tags }, { tags: [] });
      expect(eff.tags).toEqual(['a', 'b']);
      expect(eff.tags).not.toBe(tags);
    });
  });

  describe('property tests', () => {
    it('identity: applying only defaults equals defaults', () => {
      fc.assert(
        fc.property(fcRecord(), (defaults) => {
          expect(effectiveConfig(defaults)).toEqual(defaults);
        }),
      );
    });

    it('null layers are no-ops regardless of position', () => {
      fc.assert(
        fc.property(fcRecord(), fcRecord(), (a, b) => {
          const withNulls = effectiveConfig(a, null, undefined, b, null);
          const withoutNulls = effectiveConfig(a, b);
          expect(withNulls).toEqual(withoutNulls);
        }),
      );
    });

    it('most-specific wins for any primitive key both layers define', () => {
      fc.assert(
        fc.property(
          fc.record({ k: fc.string({ minLength: 1, maxLength: 8 }) }),
          fc.string(),
          fc.string(),
          ({ k }, vTop, vBottom) => {
            const eff = effectiveConfig<Record<string, string>>(
              { [k]: vTop },
              { [k]: vBottom },
            );
            expect(eff[k]).toBe(vTop);
          },
        ),
      );
    });
  });
});

// Generates simple primitive-valued records for property tests.
function fcRecord() {
  return fc.dictionary(
    fc.string({ minLength: 1, maxLength: 6 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    { maxKeys: 5 },
  );
}
