import { lookup } from 'node:dns/promises';
import net from 'node:net';

/**
 * SSRF guard for worker-issued requests.
 *
 * The worker fetches user-supplied URLs (NAVIGATE / API REQUEST steps). The
 * dangerous target is the **cloud metadata endpoint** (169.254.169.254 on
 * AWS/Azure, metadata.google.internal on GCP) — reaching it leaks instance
 * credentials, which then ride out in the step's captured response / screenshot.
 *
 * This is a self-hosted *test* platform, so users legitimately test apps on
 * internal/loopback addresses (the env baseUrl often points at localhost or a
 * staging box on a private network). Blanket-blocking RFC-1918 would break the
 * core use case. So:
 *   - ALWAYS block: link-local / cloud-metadata IPs + known metadata hostnames
 *     + non-HTTP(S) schemes (file:, gopher:, data:, …). These are never a
 *     legitimate test target.
 *   - OPT-IN block of private ranges (RFC-1918 + loopback) for strict tenants,
 *     via WORKER_SSRF_BLOCK_PRIVATE=true (default off).
 *
 * Hostnames are DNS-resolved and every resolved address is checked, so a name
 * that resolves to a metadata IP (DNS-rebinding) is still caught.
 */

const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
]);

const blockPrivate = (): boolean => process.env.WORKER_SSRF_BLOCK_PRIVATE === 'true';

function ipv4Octets(ip: string): number[] | null {
  if (net.isIPv4(ip)) return ip.split('.').map(Number);
  return null;
}

/** Link-local + cloud-metadata — ALWAYS blocked. */
function isLinkLocalOrMetadata(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (o) {
    // 169.254.0.0/16 — includes the 169.254.169.254 IMDS endpoint.
    if (o[0] === 169 && o[1] === 254) return true;
    return false;
  }
  const lc = ip.toLowerCase();
  // IPv6 link-local fe80::/10 + AWS IMDSv6 fd00:ec2::254.
  if (lc.startsWith('fe8') || lc.startsWith('fe9') || lc.startsWith('fea') || lc.startsWith('feb')) return true;
  if (lc.startsWith('fd00:ec2')) return true;
  return false;
}

/** RFC-1918 private + loopback — blocked only when WORKER_SSRF_BLOCK_PRIVATE=true. */
function isPrivateOrLoopback(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (o) {
    if (o[0] === 10) return true;                          // 10.0.0.0/8
    if (o[0] === 127) return true;                         // 127.0.0.0/8 loopback
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // 172.16.0.0/12
    if (o[0] === 192 && o[1] === 168) return true;         // 192.168.0.0/16
    if (o[0] === 0) return true;                           // 0.0.0.0/8
    return false;
  }
  const lc = ip.toLowerCase();
  if (lc === '::1') return true;                            // IPv6 loopback
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true; // fc00::/7 unique-local
  return false;
}

function assertAddressAllowed(ip: string, host: string): void {
  if (isLinkLocalOrMetadata(ip)) {
    throw new Error(`SSRF blocked: ${host} resolves to link-local / cloud-metadata address ${ip}`);
  }
  if (blockPrivate() && isPrivateOrLoopback(ip)) {
    throw new Error(`SSRF blocked: ${host} resolves to private/loopback address ${ip} (WORKER_SSRF_BLOCK_PRIVATE is on)`);
  }
}

/**
 * Throw if `rawUrl` is not a safe target for a worker-issued request.
 * Call before page.goto / fetch / page.request.fetch with a user URL.
 */
export async function assertSafeTargetUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF blocked: invalid URL "${rawUrl}"`);
  }

  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`SSRF blocked: non-HTTP(S) scheme "${u.protocol}" in ${rawUrl}`);
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`SSRF blocked: metadata hostname ${host}`);
  }
  if (host === 'localhost' && blockPrivate()) {
    throw new Error('SSRF blocked: localhost (WORKER_SSRF_BLOCK_PRIVATE is on)');
  }

  // Literal IP → check directly, no DNS.
  if (net.isIP(host)) {
    assertAddressAllowed(host, host);
    return;
  }

  // Hostname → resolve and check every address (DNS-rebinding defense).
  try {
    const records = await lookup(host, { all: true });
    for (const r of records) assertAddressAllowed(r.address, host);
  } catch (e) {
    // Re-throw our own block errors; swallow pure DNS-resolution failures so
    // the real request surfaces the network error (don't mask a typo as SSRF).
    if ((e as Error).message?.startsWith('SSRF blocked')) throw e;
  }
}
