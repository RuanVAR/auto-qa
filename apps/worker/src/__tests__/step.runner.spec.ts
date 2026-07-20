import { StepRunner } from '../steps/step.runner';
import { ArtifactCollector } from '../collectors/artifact.collector';

// Mock Playwright Locator — actions route through page.locator() since the
// fallback-selector rework, so the locator mock carries the action surface.
const mockFirst = {
  textContent: jest.fn().mockResolvedValue('Welcome to the app'),
  inputValue: jest.fn().mockResolvedValue(''),
  waitFor: jest.fn().mockResolvedValue(undefined),
};
const mockLocator: Record<string, jest.Mock> = {
  click: jest.fn().mockResolvedValue(undefined),
  dblclick: jest.fn().mockResolvedValue(undefined),
  hover: jest.fn().mockResolvedValue(undefined),
  fill: jest.fn().mockResolvedValue(undefined),
  pressSequentially: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
  selectOption: jest.fn().mockResolvedValue(undefined),
  check: jest.fn().mockResolvedValue(undefined),
  uncheck: jest.fn().mockResolvedValue(undefined),
  focus: jest.fn().mockResolvedValue(undefined),
  waitFor: jest.fn().mockResolvedValue(undefined),
  scrollIntoViewIfNeeded: jest.fn().mockResolvedValue(undefined),
  count: jest.fn().mockResolvedValue(1),
  first: jest.fn().mockReturnValue(mockFirst),
  or: jest.fn(),
};
mockLocator.or.mockReturnValue(mockLocator);

// Selector-drift tests need page.locator() to answer differently per selector
// string (primary "not found", a fallback "found") — this map is consulted
// first, falling back to the always-matches mockLocator above so every
// existing test (which never populates it) is unaffected.
let locatorBySelector: Record<string, Record<string, jest.Mock>> = {};
function makeLocator(count: number): Record<string, jest.Mock> {
  const first = {
    textContent: jest.fn().mockResolvedValue(''),
    inputValue: jest.fn().mockResolvedValue(''),
    waitFor: jest.fn().mockResolvedValue(undefined),
  };
  const loc: Record<string, jest.Mock> = {
    click: jest.fn().mockResolvedValue(undefined),
    fill: jest.fn().mockResolvedValue(undefined),
    waitFor: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(count),
    first: jest.fn().mockReturnValue(first),
    or: jest.fn(),
  };
  loc.or.mockReturnValue(loc);
  return loc;
}

// Mock Playwright Page
const mockPage = {
  goto: jest.fn().mockResolvedValue(undefined),
  url: jest.fn().mockReturnValue('https://example.com/login'),
  keyboard: { press: jest.fn().mockResolvedValue(undefined) },
  waitForTimeout: jest.fn().mockResolvedValue(undefined),
  waitForSelector: jest.fn().mockResolvedValue(undefined),
  waitForURL: jest.fn().mockResolvedValue(undefined),
  screenshot: jest.fn().mockResolvedValue(undefined),
  evaluate: jest.fn().mockResolvedValue(undefined),
  request: {
    fetch: jest.fn().mockResolvedValue({ status: jest.fn().mockReturnValue(200) }),
  },
  locator: jest.fn((sel: string) => locatorBySelector[sel] ?? mockLocator),
};

const mockCollector = {
  runDir: '/tmp/test-run',
  register: jest.fn().mockResolvedValue(undefined),
} as unknown as ArtifactCollector;

describe('StepRunner', () => {
  let runner: StepRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    locatorBySelector = {};
    runner = new StepRunner(mockPage as never, mockCollector);
  });

  it('NAVIGATE — navigates to URL and returns current url', async () => {
    const result = await runner.runStep({ type: 'NAVIGATE', input: { url: 'https://example.com' } });
    expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
    expect(result).toEqual({ url: 'https://example.com/login' });
  });

  it('CLICK — clicks the selector', async () => {
    const result = await runner.runStep({ type: 'CLICK', input: { selector: '#login-btn' } });
    expect(mockPage.locator).toHaveBeenCalledWith('#login-btn');
    expect(mockLocator.click).toHaveBeenCalled();
    expect(result).toEqual({ clicked: '#login-btn' });
  });

  it('FILL — fills input with value', async () => {
    const result = await runner.runStep({ type: 'FILL', input: { selector: '#email', value: 'test@test.com' } });
    expect(mockPage.locator).toHaveBeenCalledWith('#email');
    expect(mockLocator.fill).toHaveBeenCalledWith('test@test.com');
    expect(result).toEqual({ filled: '#email' });
  });

  it('SELECT — selects option', async () => {
    const result = await runner.runStep({ type: 'SELECT', input: { selector: '#role', value: 'admin' } });
    expect(result).toEqual({ selected: 'admin' });
  });

  it('HOVER — hovers over element', async () => {
    const result = await runner.runStep({ type: 'HOVER', input: { selector: '#menu' } });
    expect(result).toEqual({ hovered: '#menu' });
  });

  it('KEYBOARD — presses key', async () => {
    const result = await runner.runStep({ type: 'KEYBOARD', input: { key: 'Enter' } });
    expect(result).toEqual({ pressed: 'Enter' });
  });

  it('SCROLL — scrolls by default pixels when no selector', async () => {
    const result = await runner.runStep({ type: 'SCROLL', input: {} });
    expect(mockPage.evaluate).toHaveBeenCalled();
    expect(result).toMatchObject({ scrolled: { x: 0, y: 500 } });
  });

  it('SCROLL — scrolls element into view when selector given', async () => {
    const result = await runner.runStep({ type: 'SCROLL', input: { selector: '#footer' } });
    expect(result).toMatchObject({ scrolled: '#footer' });
  });

  it('WAIT — waits for timeout in ms', async () => {
    await runner.runStep({ type: 'WAIT', input: { ms: 500 } });
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(500);
  });

  it('WAIT — waits for selector', async () => {
    await runner.runStep({ type: 'WAIT', input: { selector: '#loaded' } });
    expect(mockPage.locator).toHaveBeenCalledWith('#loaded');
    expect(mockLocator.waitFor).toHaveBeenCalledWith(expect.objectContaining({ state: 'visible' }));
  });

  it('ASSERT_TEXT — passes when text found', async () => {
    const result = await runner.runStep({ type: 'ASSERT_TEXT', input: { selector: 'h1', text: 'Welcome' } });
    expect(result).toEqual({ found: 'Welcome' });
  });

  it('ASSERT_TEXT — throws when text not found', async () => {
    // Web-first assert polls until timeout — keep it tight for the test.
    mockFirst.textContent.mockResolvedValue('Something else entirely');
    await expect(
      runner.runStep({ type: 'ASSERT_TEXT', input: { selector: 'h1', text: 'MISSING', timeout: 120 } }),
    ).rejects.toThrow('Expected "MISSING"');
    mockFirst.textContent.mockResolvedValue('Welcome to the app');
  });

  it('ASSERT_VISIBLE — waits for element visibility', async () => {
    const result = await runner.runStep({ type: 'ASSERT_VISIBLE', input: { selector: '.modal' } });
    expect(result).toEqual({ visible: '.modal' });
  });

  it('ASSERT_URL — passes when URL matches', async () => {
    const result = await runner.runStep({ type: 'ASSERT_URL', input: { url: 'example.com' } });
    expect(result).toMatchObject({ url: expect.stringContaining('example.com') });
  });

  it('ASSERT_URL — throws when URL does not match', async () => {
    mockPage.url.mockReturnValueOnce('https://other.site/');
    await expect(
      runner.runStep({ type: 'ASSERT_URL', input: { url: 'expected-path' } }),
    ).rejects.toThrow('Expected URL to contain');
  });

  it('ASSERT_ELEMENT — passes when element exists in DOM', async () => {
    const result = await runner.runStep({ type: 'ASSERT_ELEMENT', input: { selector: '#hidden-elem' } });
    expect(result).toMatchObject({ found: '#hidden-elem', count: 1 });
  });

  it('ASSERT_ELEMENT — throws when element not found', async () => {
    mockLocator.count.mockResolvedValue(0);
    await expect(
      runner.runStep({ type: 'ASSERT_ELEMENT', input: { selector: '#nonexistent', timeout: 120 } }),
    ).rejects.toThrow('not found in DOM');
    mockLocator.count.mockResolvedValue(1);
  });

  it('SCREENSHOT — takes screenshot and registers artifact', async () => {
    const result = await runner.runStep({ type: 'SCREENSHOT', input: { name: 'my-screen' } });
    expect(mockPage.screenshot).toHaveBeenCalled();
    // The 4th arg is the metadata blob the runner attaches so the UI can
    // tell manual / step-bound / full-page screenshots apart. Tests only
    // care that register fired with the right name/path — accept any meta.
    expect(mockCollector.register).toHaveBeenCalledWith(
      'SCREENSHOT',
      'my-screen.png',
      expect.any(String),
      expect.any(Object),
    );
    expect(result).toEqual({ screenshot: 'my-screen.png' });
  });

  it('CUSTOM — throws when no handler registered', async () => {
    await expect(
      runner.runStep({ type: 'CUSTOM', input: { handler: 'myHandler' } }),
    ).rejects.toThrow('No custom handler registered for "myHandler"');
  });

  it('CUSTOM — executes registered handler', async () => {
    runner.registerHandler('myHandler', async (_page, _input) => ({ done: true }));
    const result = await runner.runStep({ type: 'CUSTOM', input: { handler: 'myHandler' } });
    expect(result).toEqual({ done: true });
  });

  it('throws for unknown step type', async () => {
    await expect(
      runner.runStep({ type: 'UNKNOWN_STEP', input: {} }),
    ).rejects.toThrow('Unknown step type: "UNKNOWN_STEP"');
  });
});

describe('StepRunner — selector drift detection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    locatorBySelector = {};
  });

  it('primary resolves uniquely — no heal, no fallback probed', async () => {
    const runner = new StepRunner(mockPage as never, mockCollector);
    await runner.runStep({ type: 'CLICK', input: { selector: '#login-btn', fallbackSelectors: ['[data-testid="login"]'] } });
    expect(runner.getLastResolution()).toMatchObject({ rung: 'primary', healed: false });
    expect(mockPage.locator).not.toHaveBeenCalledWith('[data-testid="login"]');
  });

  it('primary fails, a testattr fallback resolves uniquely — heals and acts on the fallback', async () => {
    locatorBySelector['#stale-btn'] = makeLocator(0);
    locatorBySelector['[data-testid="login"]'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector);

    await runner.runStep({ type: 'CLICK', input: { selector: '#stale-btn', fallbackSelectors: ['[data-testid="login"]'] } });

    expect(locatorBySelector['[data-testid="login"]'].click).toHaveBeenCalled();
    expect(locatorBySelector['#stale-btn'].click).not.toHaveBeenCalled();
    expect(runner.getLastResolution()).toMatchObject({
      rung: 'fallback', healed: true, selector: '[data-testid="login"]', strategy: 'testattr', confidence: 0.99,
    });
  });

  it('tries fallbacks in order and stops at the first unique match', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['[data-testid="a"]'] = makeLocator(0); // also stale
    locatorBySelector['[data-testid="b"]'] = makeLocator(1); // this one resolves
    const runner = new StepRunner(mockPage as never, mockCollector);

    await runner.runStep({
      type: 'CLICK',
      input: { selector: '#stale', fallbackSelectors: ['[data-testid="a"]', '[data-testid="b"]'] },
    });

    expect(runner.getLastResolution()).toMatchObject({ rung: 'fallback', fallbackIndex: 1, healed: true });
    expect(locatorBySelector['[data-testid="b"]'].click).toHaveBeenCalled();
  });

  it('a css-strategy fallback below the default sensitivity floor is skipped, not healed', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['div > span.btn'] = makeLocator(1); // css strategy, confidence 0.40
    const runner = new StepRunner(mockPage as never, mockCollector);

    await runner.runStep({ type: 'CLICK', input: { selector: '#stale', fallbackSelectors: ['div > span.btn'] } });

    const res = runner.getLastResolution();
    expect(res?.healed).toBe(false);
    expect(res?.skipped).toMatchObject({ selector: 'div > span.btn', reason: 'below-floor' });
  });

  it('a lower project sensitivity lets a css fallback clear the floor', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['div > span.btn'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector, undefined, {}, { sensitivity: 0.3 });

    await runner.runStep({ type: 'CLICK', input: { selector: '#stale', fallbackSelectors: ['div > span.btn'] } });

    expect(runner.getLastResolution()).toMatchObject({ healed: true, strategy: 'css' });
  });

  it('never heals an assertion — primary only, even with a matching fallback', async () => {
    locatorBySelector['#stale-text'] = makeLocator(0);
    locatorBySelector['[data-testid="msg"]'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector);
    locatorBySelector['#stale-text'].first.mockReturnValue({ textContent: jest.fn().mockResolvedValue('Welcome') });

    await runner.runStep({
      type: 'ASSERT_TEXT',
      input: { selector: '#stale-text', text: 'Welcome', fallbackSelectors: ['[data-testid="msg"]'] },
    });

    expect(mockPage.locator).not.toHaveBeenCalledWith('[data-testid="msg"]');
    expect(runner.getLastResolution()).toMatchObject({ rung: 'primary', healed: false });
  });

  it('never heals a negative WAIT (state: hidden) even with a matching fallback', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['[data-testid="spinner"]'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector);

    await runner.runStep({
      type: 'WAIT',
      input: { selector: '#stale', state: 'hidden', fallbackSelectors: ['[data-testid="spinner"]'] },
    });

    expect(mockPage.locator).not.toHaveBeenCalledWith('[data-testid="spinner"]');
  });

  it('never heals ASSERT_VISIBLE checking for absence (visible: false)', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['[data-testid="banner"]'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector);

    await runner.runStep({
      type: 'ASSERT_VISIBLE',
      input: { selector: '#stale', visible: false, fallbackSelectors: ['[data-testid="banner"]'] },
    });

    expect(mockPage.locator).not.toHaveBeenCalledWith('[data-testid="banner"]');
  });

  it('give-up: a valid fallback is rejected when the caller reports the threshold hit', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['[data-testid="ok"]'] = makeLocator(1);
    const giveUpCheck = jest.fn().mockResolvedValue(true);
    const runner = new StepRunner(mockPage as never, mockCollector, undefined, {}, { giveUpCheck });

    await runner.runStep({ type: 'CLICK', input: { selector: '#stale', fallbackSelectors: ['[data-testid="ok"]'] } }, { stepIndex: 4, stepName: 'Click ok' });

    expect(giveUpCheck).toHaveBeenCalledWith(4);
    const res = runner.getLastResolution();
    expect(res?.healed).toBe(false);
    expect(res?.gaveUp).toMatchObject({ selector: '[data-testid="ok"]' });
    expect(locatorBySelector['[data-testid="ok"]'].click).not.toHaveBeenCalled();
  });

  it('cascading-heal guard: a low-confidence heal poisons healing for the rest of the run', async () => {
    // Step 1: heals via `id` strategy (confidence 0.60) — allowed because
    // sensitivity is lowered to 0.5, but 0.60 is still in the `low` bucket
    // (ceiling 0.65), so it must poison subsequent steps regardless.
    locatorBySelector['#stale-1'] = makeLocator(0);
    locatorBySelector['#fallback-id'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector, undefined, {}, { sensitivity: 0.5 });
    await runner.runStep({ type: 'CLICK', input: { selector: '#stale-1', fallbackSelectors: ['#fallback-id'] } });
    expect(runner.getLastResolution()).toMatchObject({ healed: true, strategy: 'id', confidence: 0.60 });

    // Step 2: a perfectly good testattr fallback exists, but healing must be
    // refused for the rest of the run.
    locatorBySelector['#stale-2'] = makeLocator(0);
    locatorBySelector['[data-testid="good"]'] = makeLocator(1);
    await runner.runStep({ type: 'CLICK', input: { selector: '#stale-2', fallbackSelectors: ['[data-testid="good"]'] } });

    const res = runner.getLastResolution();
    expect(res?.healed).toBe(false);
    expect(res?.skipped?.reason).toBe('upstream-uncertainty');
    expect(locatorBySelector['[data-testid="good"]'].click).not.toHaveBeenCalled();
  });

  it('resets lastResolution to null at the start of every step', async () => {
    locatorBySelector['#stale'] = makeLocator(0);
    locatorBySelector['[data-testid="x"]'] = makeLocator(1);
    const runner = new StepRunner(mockPage as never, mockCollector);
    await runner.runStep({ type: 'CLICK', input: { selector: '#stale', fallbackSelectors: ['[data-testid="x"]'] } });
    expect(runner.getLastResolution()?.healed).toBe(true);

    await runner.runStep({ type: 'WAIT_MS', input: { ms: 1 } });
    expect(runner.getLastResolution()).toBeNull();
  });
});
