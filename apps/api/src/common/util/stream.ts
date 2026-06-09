import type { Readable } from 'stream';

/**
 * Collect a Readable / async-iterable stream into a single Buffer. Consolidates
 * three identical hand-rolled copies (reports, signoff, uploads) that each did
 * the `chunks.push(Buffer.from(c))` + `Buffer.concat` dance.
 */
export async function streamToBuffer(stream: Readable | AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream as AsyncIterable<unknown>) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}
