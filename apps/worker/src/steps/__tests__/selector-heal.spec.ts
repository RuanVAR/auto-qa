import {
  CONFIDENCE_BY_STRATEGY, DEFAULT_HEAL_SENSITIVITY, HEAL_GIVE_UP_THRESHOLD,
  LOW_CONFIDENCE_CEILING, NEVER_HEAL_STEP_TYPES, confidenceBucket, inferStrategy,
} from '../selector-heal';

describe('inferStrategy', () => {
  it('classifies getBy*() forms', () => {
    expect(inferStrategy('getByTestId("submit")')).toBe('testattr');
    expect(inferStrategy('getByRole("button", "Save")')).toBe('role');
    expect(inferStrategy('getByLabel("Email")')).toBe('label');
    expect(inferStrategy('getByPlaceholder("Search")')).toBe('placeholder');
    expect(inferStrategy('getByText("Login")')).toBe('text');
    expect(inferStrategy('getByTitle("Close")')).toBe('text');
    expect(inferStrategy('getByAltText("logo")')).toBe('text');
  });

  it('classifies CSS attribute-selector forms', () => {
    expect(inferStrategy('[data-testid="submit"]')).toBe('testattr');
    expect(inferStrategy('[data-test="submit"]')).toBe('testattr');
    expect(inferStrategy('[data-qa="submit"]')).toBe('testattr');
    expect(inferStrategy('[role="button"]')).toBe('role');
    expect(inferStrategy('input[placeholder="Search"]')).toBe('placeholder');
    expect(inferStrategy('button:has-text("Save")')).toBe('text');
    expect(inferStrategy('text=Login')).toBe('text');
  });

  it('classifies a bare #id as id, not label — ambiguous shape, conservative confidence', () => {
    expect(inferStrategy('#submit-button')).toBe('id');
  });

  it('falls through to css for anything unrecognised', () => {
    expect(inferStrategy('div > ul > li:nth-child(3)')).toBe('css');
    expect(inferStrategy('.btn-primary')).toBe('css');
  });
});

describe('confidenceBucket', () => {
  it('buckets high/medium/low at the documented boundaries', () => {
    expect(confidenceBucket(0.99)).toBe('high');
    expect(confidenceBucket(0.90)).toBe('high');
    expect(confidenceBucket(0.89)).toBe('medium');
    expect(confidenceBucket(0.65)).toBe('medium');
    expect(confidenceBucket(0.64)).toBe('low');
    expect(confidenceBucket(0.40)).toBe('low');
  });
});

describe('CONFIDENCE_BY_STRATEGY', () => {
  it('ranks strategies by how they actually fail, not how they look', () => {
    expect(CONFIDENCE_BY_STRATEGY.testattr).toBeGreaterThan(CONFIDENCE_BY_STRATEGY.role);
    expect(CONFIDENCE_BY_STRATEGY.role).toBeGreaterThan(CONFIDENCE_BY_STRATEGY.label);
    expect(CONFIDENCE_BY_STRATEGY.label).toBeGreaterThan(CONFIDENCE_BY_STRATEGY.placeholder);
    expect(CONFIDENCE_BY_STRATEGY.placeholder).toBeGreaterThan(CONFIDENCE_BY_STRATEGY.text);
    expect(CONFIDENCE_BY_STRATEGY.text).toBeGreaterThan(CONFIDENCE_BY_STRATEGY.id);
    expect(CONFIDENCE_BY_STRATEGY.id).toBeGreaterThan(CONFIDENCE_BY_STRATEGY.css);
  });

  it('css sits below the default sensitivity floor — never auto-heals by default', () => {
    expect(CONFIDENCE_BY_STRATEGY.css).toBeLessThan(DEFAULT_HEAL_SENSITIVITY);
  });

  it('id sits below the low-confidence ceiling used by the cascading-heal guard', () => {
    expect(CONFIDENCE_BY_STRATEGY.id).toBeLessThan(LOW_CONFIDENCE_CEILING);
  });
});

describe('NEVER_HEAL_STEP_TYPES', () => {
  it('covers every assertion type', () => {
    for (const t of [
      'ASSERT_TEXT', 'ASSERT_VISIBLE', 'ASSERT_VALUE', 'ASSERT_URL', 'ASSERT_ELEMENT',
      'ASSERT_STATUS', 'ASSERT_BODY', 'ASSERT_HEADER', 'ASSERT_EXIT', 'ASSERT_OUTPUT', 'ASSERT_CONTAINS',
    ]) {
      expect(NEVER_HEAL_STEP_TYPES.has(t)).toBe(true);
    }
  });

  it('does not cover action step types', () => {
    for (const t of ['CLICK', 'FILL', 'WAIT', 'WAIT_FOR_SELECTOR']) {
      expect(NEVER_HEAL_STEP_TYPES.has(t)).toBe(false);
    }
  });
});

describe('HEAL_GIVE_UP_THRESHOLD', () => {
  it('is 3, matching the documented three healed runs before give-up rule', () => {
    expect(HEAL_GIVE_UP_THRESHOLD).toBe(3);
  });
});
