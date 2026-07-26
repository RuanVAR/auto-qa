export interface RetryingHttpOptions {
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  secrets?: Array<string | null | undefined>;
}

export class SafeHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SafeHttpError';
  }
}

export async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: RetryingHttpOptions = {},
): Promise<{ data: T; response: Response }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const sleep = options.sleep ?? ((milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return {
          data: await response.json() as T,
          response,
        };
      }

      const body = await safeErrorBody(response);
      if (attempt < maxRetries && isRetryableStatus(response.status)) {
        await sleep(retryDelayMs(response, attempt));
        continue;
      }
      throw new SafeHttpError(
        redact(`HTTP ${response.status}: ${body}`, options.secrets),
        response.status,
      );
    } catch (error) {
      if (error instanceof SafeHttpError) throw error;
      if (attempt < maxRetries) {
        await sleep(250 * (2 ** attempt));
        continue;
      }
      throw new SafeHttpError(redact(toMessage(error), options.secrets));
    }
  }

  throw new SafeHttpError('HTTP request failed');
}

export function redact(
  value: string,
  secrets: Array<string | null | undefined> = [],
): string {
  let result = value;
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  result = result.replace(
    /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g,
    '[REDACTED PRIVATE KEY]',
  );
  return result;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1_000, 30_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  }
  return 250 * (2 ** attempt);
}

async function safeErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown; error?: unknown };
    const detail = body.message ?? body.error;
    return typeof detail === 'string' ? detail : 'request failed';
  } catch {
    return 'request failed';
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'request failed';
}
