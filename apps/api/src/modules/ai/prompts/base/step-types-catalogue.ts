/**
 * Inline cheat-sheet for the 20 UI step types the generator can emit.
 * Without this block the model improvises shapes the runner can't execute —
 * with it we get well-formed `input` objects 95%+ of the time.
 *
 * @prompt-version: step-types@1.0
 */
export const STEP_TYPES_CATALOGUE = `STEP TYPE CATALOGUE — input shape for each:

NAVIGATE              { url }                            navigate to a path or full URL
CLICK                 { selector }                       click an element
DBLCLICK              { selector }                       double-click
FILL                  { selector, value }                fill a form input (clears + types)
TYPE                  { selector, value }                type without clearing (appends)
CLEAR                 { selector }                       clear an input
SELECT                { selector, value }                pick an option from a <select>
CHECK                 { selector }                       check a checkbox (no-op if already checked)
UNCHECK               { selector }                       uncheck a checkbox
HOVER                 { selector }                       hover to reveal tooltips / menus
PRESS_KEY             { key }                            send a keyboard key (Enter, Escape, Tab, …)
SCROLL                { selector?, x?, y? }              scroll to element or by offsets
WAIT_FOR_SELECTOR     { selector, timeout? }             wait for an element to appear (ms)
WAIT_FOR_NAVIGATION   { url?, timeout? }                 wait for URL to change (optionally to a pattern)
WAIT_MS               { ms }                             fixed wait — use sparingly, prefer WAIT_FOR_*
ASSERT_TEXT           { selector, text, exact? }         visible text contains/equals
ASSERT_VISIBLE        { selector }                       element is visible in the viewport
ASSERT_VALUE          { selector, value }                input value equals
ASSERT_URL            { url, exact? }                    current URL matches
SCREENSHOT            { name?, fullPage? }               take a screenshot artifact

GENERATORS (literal text inside string values — runner expands per env):
{{$email}}            unique disposable email
{{$password}}         valid password meeting common rules
{{$firstName}}        random first name
{{$lastName}}         random last name
{{$uuid}}             random uuid
{{$now}}              ISO timestamp at runtime`;
