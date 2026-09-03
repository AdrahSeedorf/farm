# Breed standards

The tables your flock is judged against. **Nothing here is invented** — the
figures come from your breed's own management guide, and the software ships with
none until you load them.

There are two, and they are loaded the same way:

| Table | Judges | Needed by |
|---|---|---|
| **Body weight** | every weight sample, at that flock's exact age | rearing, from day one |
| **Lay curve** | production, week by week | point of lay, ~week 18 |

## Where to get the numbers

Every layer breeder publishes a management guide with both tables, free to
download:

| Breed | Look for |
|---|---|
| Isa Brown | ISA Brown Product Guide → "Body weight", "Production performance" |
| Lohmann Brown | Lohmann Brown-Classic Management Guide → "Body weight development", "Laying rate" |
| Hy-Line Brown | Hy-Line Brown Management Guide → "Rearing body weight", "Hen-day production" |
| Bovans Brown | Bovans Brown Product Guide → "Body weight", "Production" |
| Nova Brown | Nova Brown Management Guide → "Body weight", "Laying percentage" |

For weight, take the **rearing** table — day-old through to about week 20.
Nothing beyond point of lay is needed for weight tracking.

For the lay curve, take the **whole production period** — roughly week 18
through to depletion. The comparison stops wherever the table stops rather than
extrapolating, so a table that ends at week 80 simply reports nothing after that.

## The files

Two columns each, copied straight out of the guide. Guides publish weekly, so a
`week` column is fine and gets converted:

```csv
week,grams
1,70
2,115
3,170
...
17,1400
```

```csv
week,henDayPct
19,28.5
20,58.0
21,80.4
...
28,94.4
```

An `ageDays` column works the same way for either. Blank lines and `#` comments
are ignored. The production column can be called any of the things guides
actually call it — `henDayPct`, `lay`, `laying rate`, `production`, or just `%` —
and a figure written `28.5%` is read as 28.5.

## Loading them

```bash
npm run standards:load -- standards/isa-brown-weight.csv --breed isa_brown --dry-run
```

```bash
npm run standards:load -- standards/isa-brown-weight.csv --breed isa_brown
```

The breed key is required: an ISA Brown and a Lohmann Brown neither weigh the
same at eight weeks nor lay the same at thirty, so one table loaded against every
layer would report a healthy flock as behind target.

**Which kind of table it is comes from the column headings, and is printed
before anything is written.** A lay curve loaded into the weight column would
produce targets that look plausible and are nonsense, so the loader says which
it decided and you can stop it. Pass `--kind weight` or `--kind lay` if your
headings are unusual.

The loader warns about the mistakes that actually happen:

- a weight that **falls** as the birds age — a mistyped digit, or the columns
  read in the wrong order
- a weight table that **starts late**, leaving early samples with no target
- a production figure **above 100** — a hen lays at most one egg a day, so this
  is refused outright rather than warned about
- a lay curve that is all **fractions** (0.9) rather than percentages (90), which
  would otherwise make every flock look a hundred times behind its own standard

It deliberately does *not* warn when a lay curve falls. A flock peaks around week
28 and declines for the rest of the cycle; that is the shape of a correct table.

## After loading

Weight samples are scored at the flock's exact age, interpolating between the
weekly points. Production is compared week by week, against the curve at the
middle of each week. Outside the range of either table nothing is shown rather
than extrapolating — a guess beyond the data becomes a quoted fact later.

Loading a new file replaces that table only; the other one is left alone. The
file name and the date are stored alongside the figures, so a later reader can
tell which edition they came from.
