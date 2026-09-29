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
