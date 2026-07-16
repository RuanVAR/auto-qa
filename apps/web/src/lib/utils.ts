import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export function formatDuration(ms?: number | null): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
export function formatDate(date?: string | Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));
}

/**
 * Extract the API's real error message from an axios error, handling BOTH
 * shapes NestJS produces: a plain string, and class-validator's ARRAY of
 * failures. Array-blind handlers silently swallow exactly the validation
 * errors users most need to see (the invite-form lesson).
 */
export function errMsg(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  if (Array.isArray(msg)) return msg.filter((m) => typeof m === 'string').join('; ') || fallback;
  return typeof msg === 'string' ? msg : fallback;
}
