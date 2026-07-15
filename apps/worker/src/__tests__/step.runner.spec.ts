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
  locator: jest.fn().mockReturnValue(mockLocator),
};

const mockCollector = {
  runDir: '/tmp/test-run',
  register: jest.fn().mockResolvedValue(undefined),
} as unknown as ArtifactCollector;

describe('StepRunner', () => {
  let runner: StepRunner;

  beforeEach(() => {
    jest.clearAllMocks();
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
