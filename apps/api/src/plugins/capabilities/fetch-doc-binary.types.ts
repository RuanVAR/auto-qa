/**
 * fetchDocBinary — fetch the raw bytes of a binary external doc (PDF, image).
 *
 * Unlike fetchDoc (which returns text/markdown/HTML), this returns the file's
 * bytes for the platform to stream back to the browser via /doc-links/:id/raw.
 * The Buffer crosses the dispatch boundary in-process (a direct function call),
 * so no base64 round-trip is needed.
 */
export type FetchDocBinaryInput = {
  externalId: string;
};

export type FetchDocBinaryOutput = {
  buffer: Buffer;
  contentType: string;
  filename?: string;
};
