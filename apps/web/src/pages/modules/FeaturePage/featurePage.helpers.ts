// ─── Shared helpers + constants for FeaturePage + ManualPlayer ───────────────
// Extracted from FeaturePage.tsx as part of the 2656-line split.
// Pure functions — no React, no DOM.

import type { RunStep } from './featurePage.types';

// ─── Constants ───────────────────────────────────────────────────────────────
export const MAX_FILE_SIZE_MB = 10;
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
export const INACTIVITY_WARNING_MS = 30 * 60 * 1000;
export const LEFT_PANEL_KEY = 'manual_left_panel_open';

// ─── Step instruction renderer ──────────────────────────────────────────────
// Given a RunStep, return the human-readable instruction shown in the
// manual testing UI. Prefers the author-written `input.description` if set,
// otherwise derives a sensible sentence from the step type + inputs.
export function stepInstruction(step: RunStep): string {
  const input = (step.input as Record<string, string> | null) ?? {};
  if (input.description) return input.description;
  switch (step.type) {
    case 'NAVIGATE':
      return `Go to: ${input.url ?? input.path ?? '—'}`;
    case 'CLICK':
      return `Click: ${input.selector ?? '—'}`;
    case 'DBLCLICK':
      return `Double-click: ${input.selector ?? '—'}`;
    case 'HOVER':
      return `Hover over: ${input.selector ?? '—'}`;
    case 'FILL':
      return `Fill "${input.selector ?? input.label ?? 'field'}" with: ${input.value ?? '—'}`;
    case 'TYPE':
      return `Type "${input.value ?? '—'}" into: ${input.selector ?? 'focused element'}`;
    case 'SELECT':
      return `Select "${input.value ?? '—'}" from: ${input.selector ?? '—'}`;
    case 'CHECK':
      return `Check checkbox: ${input.selector ?? '—'}`;
    case 'UNCHECK':
      return `Uncheck checkbox: ${input.selector ?? '—'}`;
    case 'PRESS_KEY':
      return `Press key: ${input.key ?? '—'}`;
    case 'SCROLL':
      return `Scroll ${input.deltaY ? (Number(input.deltaY) > 0 ? 'down' : 'up') : 'on page'}`;
    case 'ASSERT_TEXT':
      return `Verify page shows: "${input.expectedText ?? input.text ?? '—'}"`;
    case 'ASSERT_URL':
      return `Verify URL is: ${input.expectedUrl ?? input.url ?? '—'}`;
    case 'ASSERT_VISIBLE':
      return `Verify element is visible: ${input.selector ?? '—'}`;
    case 'ASSERT_VALUE':
      return `Verify value of "${input.selector ?? '—'}" is: ${input.value ?? '—'}`;
    case 'WAIT_MS':
    case 'WAIT':
      return `Wait ${input.ms ?? input.duration ?? '?'}ms`;
    case 'WAIT_FOR_SELECTOR':
      return `Wait for element: ${input.selector ?? '—'}`;
    case 'WAIT_FOR_NAVIGATION':
      return `Wait for page navigation`;
    case 'SCREENSHOT':
      return `Take a screenshot${input.label ? `: ${input.label}` : ''}`;
    case 'API_REQUEST':
      return `${input.method ?? 'GET'} request to: ${input.url ?? '—'}`;
    case 'EXECUTE_SCRIPT':
      return `Execute script: ${input.script ? input.script.slice(0, 60) + (input.script.length > 60 ? '…' : '') : '—'}`;
    default:
      return `${step.type}`;
  }
}
