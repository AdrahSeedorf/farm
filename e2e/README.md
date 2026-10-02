# Browser suites

Playwright suites that drive the real application against a real database and
assert real numbers — not that a page rendered.

**These live in the repository deliberately.** They used to sit in a scratch
directory on the machine that ran them, and when that machine was reclaimed the
whole set went with it. A verification asset that only exists on one computer is
one power cut away from not existing. Anything written from now on goes here.

## Running them

They need the application running against a database you do not mind writing to.
Every suite clears its own rows first, in foreign-key order, so they can be run
repeatedly and in any order.

```bash
npm run build && PORT=3111 npm run start   # in one terminal
node e2e/payments.mjs                      # in another
```

`E2E_BASE` overrides the URL (default `http://127.0.0.1:3111`).

They sign in as real users with real roles, because a suite that fabricates a
principal proves nothing about the permission system it is meant to be testing.
Each expects the accounts the seed creates plus one per role, all on the same
password.

## What a suite is for

Unit tests cover the arithmetic. These cover the things only a browser can: that
a form which is refused keeps what somebody typed, that a figure a role must not
see is absent from the HTML rather than hidden in it, and that two screens
written weeks apart still agree about the same number.

## `stock-take.mjs` — Task 16.2

49 checks. The two that matter most are the ones that nearly did not exist:

- **The batches must still add up to the location after an adjustment.** Stock
  that FEFO cannot select is stock dispatch can never send, and it would sit on
  the headline figure forever without ever being sellable.
- **The warning must speak in the unit somebody counted in.** The first version
  told a storekeeper who counted four bags instead of five that fifty were
  missing. The arithmetic was right and the sentence was wrong, which is the
  worst combination — nothing fails, and the person acts on it.

### Two traps this suite hit, written down so the next suite does not

1. **`page.click('button[type=submit]')` matches the navigation's sign-out
   button.** The suite was signing itself out and landing on the login page,
   which is indistinguishable from a permission failure. Every submit here is
   scoped: `main form button[type=submit]:has-text("Save")`.
2. **`page.locator('main h1').waitFor()` resolves against the page you have not
   left yet.** Third time this has cost an afternoon. Wait for a heading unique
   to the destination.

### Harness note

`ddl.mjs` (the throwaway DDL generator, container-only) skipped scalar LIST
fields, so `Supplier.supplies` was missing from the harness database and every
supplier query failed with P2022. Fixed to emit `text[] NOT NULL DEFAULT '{}'`.

## `lighting.mjs`

38 checks. Three of them exist because the browser found real defects the unit
tests could not:

- **Unknown must not read as safe.** The warning about shortening a laying
  flock's day had three states collapsed into two: known-in-lay got the loud
  warning, and *everything else* — including "nobody has told this system when
  laying starts" — got the mild one. The shipped draft was not attached to a
  production type, so it hit exactly that path. Unknown now says it is unknown,
  and the draft attaches itself to the farm's production type when there is only
  one.
- **A warning that fires on every correct save is not a warning.** A blank lux
  figure is true of almost every row on almost every farm, and it was forcing a
  confirm-and-resubmit on every single step. It is information on the programme
  screen now, not a gate.
- **No latitude, no times.** The farm's coordinates are nullable and nothing
  fills them in. The suite asserts the screen prints *no* switch-on time at all
  rather than quietly assuming 6°N because the farm is in Ghana.

### Selector traps, both hit here

1. `button[type=submit]` matches the navigation's sign-out form. Scope to
   `main form button[type=submit]`.
2. `:has-text("Save")` also matches `"Save this step"`, so the mode form's save
   silently submitted the step form instead. Use `:text-is("Save")` when one
   button's label is a substring of another's.
