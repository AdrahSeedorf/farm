# Breed standards

The body-weight table your flock is judged against. **Nothing here is invented** —
the figures come from your breed's own management guide, and the software ships
with none until you load them.

## Where to get the numbers

Every layer breeder publishes a management guide with a body-weight table, free
to download:

| Breed | Look for |
|---|---|
| Isa Brown | ISA Brown Product Guide → "Body weight" |
| Lohmann Brown | Lohmann Brown-Classic Management Guide → "Body weight development" |
| Hy-Line Brown | Hy-Line Brown Management Guide → "Rearing body weight" |
| Bovans Brown | Bovans Brown Product Guide → "Body weight" |
| Nova Brown | Nova Brown Management Guide → "Body weight" |

Take the **rearing** table — day-old through to about week 20. Nothing beyond
point of lay is needed for weight tracking.

## The file

Two columns, copied straight out of the guide. Guides publish weekly, so a
`week` column is fine and gets converted:

```csv
week,grams
1,70
2,115
3,170
...
17,1400
```

An `ageDays` column works the same way. Blank lines and `#` comments are ignored.

## Loading it

```bash
npm run standards:load -- standards/your-breed.csv --dry-run   # check first
npm run standards:load -- standards/your-breed.csv
```

The loader warns about the two mistakes that actually happen: a weight that
*falls* as the birds age (a mistyped digit, or the columns read in the wrong
order), and a table that starts late, which would leave early samples with no
target.

## After loading

Every weight sample is scored at that flock's exact age, interpolating between
the weekly points. Outside the range of the table it shows nothing rather than
extrapolating — a guess beyond the data becomes a quoted fact later.

Loading a new file replaces the previous table. The file name and the date are
stored alongside it, so a later reader can tell which edition the numbers came
from.
