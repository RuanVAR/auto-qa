import { chunkDocuments } from './chunker';

describe('chunkDocuments', () => {
  it('is deterministic and extracts symbols, selectors, and routes', () => {
    const source = `
export function LoginForm() {
  return <form action="/login">
    <input data-testid="email" aria-label="Email address" name="email" />
  </form>;
}

export class AccountClient {
  async load() {
    return fetch("/api/accounts");
  }
}`;
    const first = chunkDocuments([{ filePath: 'src/login.tsx', content: source }], {
      targetCharacters: 200,
      overlapCharacters: 40,
    });
    const second = chunkDocuments([{ filePath: 'src/login.tsx', content: source }], {
      targetCharacters: 200,
      overlapCharacters: 40,
    });

    expect(second).toEqual(first);
    expect(first.map((chunk) => chunk.symbol)).toEqual(['LoginForm', 'AccountClient']);
    expect(first.flatMap((chunk) => chunk.selectors)).toEqual(expect.arrayContaining([
      'aria-label=Email address',
      'data-testid=email',
      'name=email',
    ]));
    expect(first.flatMap((chunk) => chunk.routes)).toEqual(expect.arrayContaining([
      '/api/accounts',
      '/login',
    ]));
  });

  it('windows large source with bounded overlap', () => {
    const chunks = chunkDocuments([
      { filePath: 'src/large.ts', content: `function large() {\n${'const value = 1;\n'.repeat(100)}}` },
    ], {
      targetCharacters: 300,
      overlapCharacters: 40,
    });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.content.length <= 300)).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
      chunks.map((_chunk, index) => index),
    );
  });
});
