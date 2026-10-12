# Seeing it work before there are birds

There is no flock yet, so every screen is empty and nobody can tell a working
dashboard from a broken one. This builds a farm that never existed — placed,
reared, brought into lay, sold from, paid for — so you can walk your own
software before buying a chick.

```
npm run demo:seed      about 400 days of a 1,000-bird flock
npm run demo:clear     remove it again
```

---

## Do this on a scratch database. Not the real one.

**This is the only part of this page that matters.** Three hundred days of
invented records mixed into your real first flock cannot be told apart
afterwards — not by this script, not by you, not by me. The script refuses to
run against anything that is not on your own machine unless you pass `--force`,
and refuses to run where operating data already exists. Do not reach for
`--force` to get past the first refusal on your live database.

### Making one from a Neon branch — about a minute, costs nothing

1. In the Neon console, open your project → **Branches** → **New branch**.
   Name it `demo`. It is an instant copy; it does not touch `main`.
2. Copy that branch's connection string.
3. Make a `.env.demo` beside your `.env`:

   ```
   DATABASE_URL="<the demo branch's pooled URL>"
   DIRECT_DATABASE_URL="<the demo branch's direct URL>"
   AUTH_SECRET="<anything, this is a scratch database>"
   NEXTAUTH_URL="http://localhost:3000"
   ```

4. Run everything against it by swapping the file in:

   ```
   cp .env .env.real && cp .env.demo .env
   npm run demo:seed -- --force
   npm run dev
   ```

5. When you are finished: `cp .env.real .env`, and delete the branch in Neon.

The `--force` is needed because the branch is not on your machine. That is the
one place you should use it, and only once you have checked the host printed at
the top of the output is the **demo** branch and not `main`.

---

## What to look at, in this order

| Screen | What the demo makes visible |
|---|---|
| **Dashboard** | Birds alive, today's mortality, eggs, and the alerts that are actually firing. |
| **Report** → Last month | The reconciliation: what was counted in the houses against what reached the store. This is the thing only this software does. |
| **Flocks** → the flock → Production | The lay curve rising to peak and declining, week by week, with the grade split shifting from small eggs to large as the flock ages. |
| **Flocks** → the flock → Costs | Feed and wages charged against the birds, and cost per point-of-lay pullet. |
| **Money in** | Four buyers, real balances, most loads paid and some not. |
| **Store** | Feed cover in days, and one stock count that came up two bags short with a reason. |
| **Report** → Download day by day | 400 rows of real daily figures in a spreadsheet. |

---

## What it invents, and what it refuses to

It invents a flock's **history**: what it ate, drank, laid and lost, day by day,
drawn from general layer behaviour — mortality heaviest in brooding, lay rising
to a peak near 94% around week 30 and declining slowly after, feed climbing to
about 115 g a bird.

It does **not** invent a breed's **standard**. Every "vs standard" column still
reads a dash, because nobody has pasted the breeder's table in. That is the
honest behaviour and a better demonstration than a fabricated comparison: it
shows the software admitting what it does not know.

**Paste the real ISA Brown guide in at Settings → Breed standards and the
comparison appears against the demo flock.** That is worth doing while the demo
is loaded — it is the fastest way to see what those columns are for.

It is also roughly right rather than precise. Good enough to make the screens
behave like a real farm's; nowhere near good enough to plan with.

---

## It is the same farm every time

The figures come from a seeded generator, so re-running produces an identical
farm. A demo you cannot reproduce is one where a bug found while showing it to
somebody can never be found again.

`--days 240` gives you a younger flock, still in early lay. `--days 504` runs a
full commercial cycle to depletion.

---

## What `demo:clear` removes

All **operating** data: the flock, its ledger, daily records, collections, stock
movements, batches, costs, buyers, products, prices, orders, loads, payments and
stock counts.

It keeps the **setup**: units of measure, roles and permissions, the
organisation, the site and its houses, the species and production type, the
lifecycle stages, the grades, the breeds and the user accounts. Those describe
how the farm is configured; only the first kind is invented here.

---

## It found four real problems the first time it ran

Worth saying, because it is the argument for doing this at all:

- Sales were clearing only a tenth of production, leaving 176,000 eggs on the
  shelf — months past eating.
- Pullet eggs were never offered for sale, so every small egg the flock laid in
  its first weeks accumulated for ever.
- **The alert engine was telling the farm to order its own eggs**, from a
  supplier that does not exist, because the supplier is the birds. That was a
  defect in the application, not the demo. It is fixed.
- The wage bill bypassed the Costs screen, because it was charged to the flock
  directly instead of through an allocation.

Every figure on every screen was arithmetically correct in all four cases. The
sentences were absurd. No unit test was going to notice.
