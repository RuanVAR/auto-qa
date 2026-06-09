/**
 * Reject if `p` doesn't settle within `ms`. The underlying work isn't cancelled
 * (callers like email/storage treat the result as best-effort), but the awaiting
 * request is unblocked so a hung external dependency (SMTP, object store) can't
 * pin a request indefinitely and exhaust the connection pool.
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p.finally(() => clearTimeout(timer)), timeout]);
}
