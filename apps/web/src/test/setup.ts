import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { server } from './server';

// Start MSW before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
// Reset handlers after each test (so one test's overrides don't bleed into another)
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
// Stop MSW after all tests
afterAll(() => server.close());
