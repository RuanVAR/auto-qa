import { orderByDurationDesc } from '../test-duration';

describe('orderByDurationDesc', () => {
  it('orders longest-first (LPT heuristic)', () => {
    const candidates = [
      { id: 'a', testDefinitionId: 'td-short' },
      { id: 'b', testDefinitionId: 'td-long' },
      { id: 'c', testDefinitionId: 'td-medium' },
    ];
    const p50 = new Map([['td-short', 1000], ['td-long', 30000], ['td-medium', 10000]]);

    const ordered = orderByDurationDesc(candidates, p50);

    expect(ordered.map(c => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts unknown-duration candidates (no history yet) after every known duration', () => {
    const candidates = [
      { id: 'known-short', testDefinitionId: 'td-1' },
      { id: 'unknown', testDefinitionId: 'td-new' },
      { id: 'known-long', testDefinitionId: 'td-2' },
    ];
    const p50 = new Map([['td-1', 500], ['td-2', 20000]]);

    const ordered = orderByDurationDesc(candidates, p50);

    expect(ordered.map(c => c.id)).toEqual(['known-long', 'known-short', 'unknown']);
  });

  it('breaks ties by original order — stable sort', () => {
    const candidates = [
      { id: 'first', testDefinitionId: 'td-1' },
      { id: 'second', testDefinitionId: 'td-2' },
    ];
    const p50 = new Map([['td-1', 5000], ['td-2', 5000]]);

    const ordered = orderByDurationDesc(candidates, p50);

    expect(ordered.map(c => c.id)).toEqual(['first', 'second']);
  });

  it('is a no-op for an empty list', () => {
    expect(orderByDurationDesc([], new Map())).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const candidates = [
      { id: 'a', testDefinitionId: 'td-short' },
      { id: 'b', testDefinitionId: 'td-long' },
    ];
    const original = [...candidates];
    orderByDurationDesc(candidates, new Map([['td-short', 1], ['td-long', 2]]));
    expect(candidates).toEqual(original);
  });
});
