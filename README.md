# ADRAH Farms — Platform

The digital operating system for a commercial layer poultry farm in Ghana, built so it can
grow into other species and other sites without being rewritten.

**Status:** Milestone 3 — Flocks & the population ledger. See [Milestones](#milestones).

---

## Quick start

```bash
npm install            # also runs `prisma generate`
cp .env.example .env   # then paste your Neon connection strings
npm run db:migrate     # create the schema
npm run db:seed        # units, permissions, roles, farm structure
npm run dev            # http://localhost:3000
```

### Database

The project uses **Neon** (managed PostgreSQL) so development and production
behave identically. Create a free project at [neon.com](https://neon.com), choose
a European region — London or Frankfurt are far better from Accra than any US
region — and copy **both** connection strings into `.env`:

| Variable | Which string | Used by |
|---|---|---|
| `DATABASE_URL` | pooled — has `-pooler` in the hostname | the application at runtime |
| `DIRECT_DATABASE_URL` | direct — same host without `-pooler` | Prisma Migrate only |

Migrations need an unpooled connection: DDL run through a transaction pooler
fails in confusing ways. Neon provisions the migration shadow database itself,
so `SHADOW_DATABASE_URL` stays empty.

Neon's free plan scales compute to zero after 5 minutes idle, so the first
request after a quiet spell takes a second or two. `.env.example` documents two
offline alternatives (`npm run db:dev`, or Homebrew Postgres) if you need to work
without a connection.

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run test` | Vitest (135 tests) |
| `npm run db:migrate` | Create/apply a migration |
| `npm run db:seed` | Seed reference and starter data |
| `npm run db:studio` | Browse the database |
| `npm run user:password` | Set or reset a password |
| `npm run rebuild:derived` | Rebuild cached values from the ledger |

---

## Architectural rules

These four rules are the reason this codebase should still be trustworthy in three years.
They are enforced by tests, not by good intentions. **Do not work around them.**

### 1. Population and stock are derived, never stored

There is no writable `population` column on `AnimalGroup`, and no `quantityOnHand` on
`Item`. Both are the signed sum of an append-only event ledger
(`AnimalGroupEvent`, `StockMovement`).

A correction is a **new `ADJUSTMENT` event with a reason code and an author** — never an
edit to history, never a delete.

> **Why.** A farm system where someone can type a corrected bird count into a field will,
> within months, hold a population that disagrees with its own mortality history and its
> own sales records. At that point nobody can say which is true, and every report built on
> top is suspect. Here the current number is always reproducible from first principles.

`AnimalGroupSnapshot` exists purely as a performance cache and is safe to truncate and
rebuild at any time.

### 2. Money is integer pesewas

All monetary values are whole numbers of pesewas (GHS × 100), handled through
`src/lib/money.ts`. Never a float, never a bare `number`.

`allocate()` and `allocateByWeights()` split an amount across flocks or orders such that
the parts always sum **exactly** to the original — naive division quietly loses money on
every split.

### 3. Quantities carry their unit

Stored in the base unit of their dimension (`piece`, `kg`, `litre`), displayed in whatever
unit the user thinks in. `src/lib/uom.ts` **throws** on a cross-dimension conversion,
because "how many kilograms is a crate" has no answer and guessing one is how bad data
enters a farm system.

A crate is 30 eggs. A feed bag is 50 kg. Both are data, not assumptions in code.

### 4. Authorisation is server-side, in one gate

`authorize(principal, permission, siteId)` in `src/lib/rbac.ts` is called by every server
action and route handler before it touches data. It **throws** rather than returning false,
so a forgotten `if` cannot leak access.

Hiding a navigation link is not access control.

---

## The species framework

Nothing in the core is named `Flock`, `Chicken`, `House` or `Egg`.

```
Organisation → Site → ProductionUnit → AnimalGroup → lifecycle stages
```

| Core concept | Poultry | Pigs | Cattle | Fish |
|---|---|---|---|---|
| `ProductionUnit` | House | Pen | Paddock | Pond |
| `AnimalGroup` | Flock | Herd / Batch | Herd | Stock |
| Production | Eggs | Piglets | Milk | Harvest weight |

`SpeciesProfile.terminology` supplies the words the UI shows.
`ProductionTypeProfile.capabilities` decides which record types apply — layers get egg
records and lighting programmes, broilers get weight sampling and harvest planning.
`ProductionTypeProfile.standards` holds breed curves and alert thresholds.

**Adding pigs later is new rows, not a schema migration.**

Nothing in `src/lib/metrics.ts` hard-codes a breed standard, a healthy mortality rate or a
vaccination age. Those are configuration, set on veterinary advice. The code computes; it
does not prescribe.

---

## Project layout

```
prisma/
  schema.prisma          Species-agnostic core, event ledgers, RBAC, audit
  seed.ts                Units, permissions, roles, farm structure
src/
  app/
    globals.css          Design tokens — the only place colours are defined
    layout.tsx           Root layout (see the font note inside)
    page.tsx             Milestone 0 verification page; deleted at Milestone 14
  components/
    brand/Logo.tsx       The mark, in code — no image asset to go stale
    ui/KpiTile.tsx       Dashboard figure, with the status-colour rule applied
  lib/
    money.ts             Integer pesewas, exact apportioning
    uom.ts               Units of measure and conversion
    metrics.ts           EVERY production formula, documented and tested
    ledger.ts            Event sign rules and population derivation
    rbac.ts              Permission catalogue, role matrix, the authorisation gate
    brand.ts             Company facts, WhatsApp/tel link builders
    db.ts                Prisma client (driver adapter, lazily created)
    password.ts          Argon2id hashing
    session.ts           Session → Principal; the page and action guards
    rate-limit.ts        Database-backed sign-in throttling
    scope.ts             Site scoping, applied IN queries not after them
    audit.ts             Who changed what, with secrets stripped
    ghana.ts             The 16 regions, as data
    flock-service.ts     THE ONLY writer to the population ledger
    reason-codes.ts      Controlled vocabulary for why birds left the flock
  auth.ts                Auth.js configuration and the revocation callback
  proxy.ts               Redirect convenience only — NOT the security boundary
```

### Authentication (Milestone 1)

Auth.js v5 with a Credentials provider and Argon2id hashing.

**Sessions are JWTs, because Auth.js requires that with credentials.** A signed
token cannot be deleted server-side the way a session row can — so the `jwt`
callback in `src/auth.ts` re-reads the user from the database on **every**
request and returns null the moment they are deactivated. That restores
immediate revocation, and keeps roles current without forcing a re-login. It
costs one small indexed query per request, which is obviously the right trade at
this scale.

**Three guards, deliberately different:**

| Use | Function | On failure |
|---|---|---|
| Any authenticated page | `requirePrincipal()` | redirect to `/login` |
| A page needing a permission | `pageGuard()` | render a clear "no access" screen |
| A server action | `requirePermission()` | **throws** |

A worker opening the owner dashboard made a navigation mistake and gets an
explanation. The same thing inside a server action means the UI should never
have offered it — that is a bug or an attack, and it must be loud.

**Sign-in failures are indistinguishable.** Wrong password, unknown email and
deactivated account return identical text, and an unknown email still burns
comparable time hashing — otherwise response timing turns the login form into an
account-enumeration oracle.

### Site scoping (Milestone 2)

A permission answers *"may this person edit farms?"*. Scoping answers *"which
farms?"*. Both must hold, and **they fail differently**:

- Missing permission → a clear "no access" screen.
- Out of scope → **404**. "You may not view this farm" still confirms the farm
  exists; a farm outside your scope should be indistinguishable from one that was
  never created.

Scope is built into the Prisma `where` clause by `src/lib/scope.ts`, never applied
as an `if` after fetching. Filtering afterwards means the row was already read and
is one careless log line from leaking — and a list query that forgets the filter
returns *everything*. Building it into the query makes the safe thing the default.

An **empty** `siteScope` means unrestricted (the owner). That inversion is the
one real risk in the design, so it is asserted first in the tests and read only
through the helpers.

### The population ledger (Milestone 3)

`src/lib/flock-service.ts` is the **only** place that writes an
`AnimalGroupEvent`. Nothing else calls `db.animalGroupEvent.create`. The sign of
an event, the age stamp and the coherence check all live there, so they cannot be
forgotten at a call site written in a hurry months from now.

Every write runs in a transaction that re-reads the running total **inside** the
transaction and **refuses any event that would take the population below zero**.
That refusal is loud on purpose: a negative population means an event was
recorded against the wrong flock — almost always mortality entered on the wrong
house. Silently clamping to zero would hide the mistake and corrupt every metric
built on top of it.

**A correction never edits history.** Recording a physical recount adds an
`ADJUSTMENT` event with a reason code and an author; the original mortality row
stays exactly as it was reported. The flock timeline shows both.

**Dead-on-arrival is a separate mortality event**, not a smaller placement. You
received what the supplier delivered; some of them were dead. Both facts belong
in the record, and DOA% is a real signal about that supplier.

**Dates cannot be in the future.** The `max` attribute on a date input is a
courtesy to the person typing, not a control. A hatch date typed as next year
gives the flock a negative age — and age is the spine of this system, driving
vaccination scheduling, lay-curve comparison and body-weight targets. The flock
would look plausible and every derived number would be wrong.

Run `npm run rebuild:derived` to reconstruct cached values from the ledger. Being
able to run it is what makes it safe to denormalise anything at all.

### Audit log

Wired up now rather than later, because an audit trail added after the fact has a
hole exactly where the interesting history would have been. It records only
**changed** fields, strips anything secret at every level, and **never throws** —
a farm that cannot record a mortality because the log table is full is a worse
outcome than a gap in the log.

### Why `metrics.ts` is one file

A farm metric computed in three places will eventually be computed three different ways,
and the dashboard will disagree with the report. When that happens nobody trusts either.
There is exactly one implementation of hen-day production in this codebase.

Every function returns `null` rather than `NaN` when its denominator is zero. The UI renders
null as `—`, which is honest. A zero would be a lie.

---

## Stack

| Technology | Why |
|---|---|
| **Next.js 16 + React 19 + TypeScript** | One codebase for a static marketing site and an authenticated app. Server Components keep the JS bundle small on poor connections. |
| **PostgreSQL + Prisma 7** | Deeply relational domain with strict integrity needs. Prisma 7 uses a driver adapter — no query-engine binary ships with the app. |
| **Tailwind CSS v4** | CSS-first theming: the design tokens in `globals.css` *are* the Tailwind theme. |
| **Zod** | One validation schema shared by client form and server handler. |
| **Vitest** | Fast unit tests over the pure domain libraries. |

Deliberately **not** used: Redis, microservices, GraphQL, IoT, any AI feature. Each was
considered and rejected in the specification with reasons.

---

## Testing

```bash
npm run test
```

135 tests over the domain core. They exist to catch the failures that would actually hurt:

- money that drifts when a shared cost is split across flocks
- a mortality event recorded with the wrong sign, resurrecting birds
- a crate silently converted into kilograms
- a farm worker reaching a financial screen
- a metric returning `NaN` on an empty flock and rendering as `0`

The permission tests assert the specification's rules directly — a worker sees no financial
resource under any action, and sales staff cannot write to flock or health records.

---

## Milestones

| # | Milestone | Status |
|---|---|---|
| 0 | Foundations — schema, domain core, tokens, CI | ✅ Done |
| 1 | Auth & RBAC — login, sessions, rate limiting, the gate | ✅ Done |
| 2 | Org & sites — farms, houses, site scoping, audit log | ✅ Done |
| 3 | Flocks — placement, population ledger, timeline | ✅ Done |
| 4 | Daily record — the core mobile entry screen | Next |
| 5 | Rearing — chick arrival, brooding, weight & uniformity | |
| 6 | Feed & inventory | |
| 7 | Health — programmes, vaccination scheduling, medication | |
| 8 | Flock costing — cost per point-of-lay pullet | |
| 9 | Egg production — grading, hen-day, production curve | |
| 10 | Biosecurity | |
| 11 | Procurement | |
| 12 | Workforce — clock in/out, tasks, incidents | |
| 13 | Owner command centre — dashboard, alerts | |
| 14 | Public website | |
| 15 | Sales — unified orders, payments | |
| 16 | Reports | |
| 17 | Hardening — performance, accessibility, security, restore drill | |
| 18 | Launch | |

Milestones 1–8 must be live **before the chicks arrive**. Brooding is where a first flock is
won or lost, and it is unrecorded time that cannot be recovered.

---

## Outstanding decisions

Tracked in the specification's assumption register:

1. Region, district, nearest town; target placement date
2. Breed — determines which body-weight and lay-curve standards are seeded
3. Brooding heat source and generator backup — shapes an early alert rule
4. Legal suffix (Ltd / Enterprise) and confirmed tagline
5. Business phone numbers, and which is the WhatsApp line
