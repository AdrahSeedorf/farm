# Restoring the database

A backup nobody has restored is not a backup. It is a file, and a belief.

This is the drill that turns one into the other, and the procedure for the day
it stops being a drill.

```
npm run restore:drill
```

It takes about as long as your database is large. It never writes to the live
database — the only thing it does to it is `pg_dump`, which is a read.

---

## What it actually does

1. **Dumps** the live database to a temporary file.
2. **Creates** a scratch database with a generated name.
3. **Restores** the dump into it, with `--exit-on-error`, so a restore that
   reports problems and carries on is treated as a failure rather than a
   success with footnotes.
4. **Checks whether the restored copy is usable** — which is a different and
   much stronger claim than whether the restore completed.
5. **Drops** the scratch database and the dump, unless you pass `--keep`.

It exits non-zero when the verdict is NOT USABLE, so it can be run on a
schedule and shout.

### It refuses to restore over the live database

If the target resolves to the same host and database as the source, it stops
before doing anything. A drill that restores over production is the disaster it
was meant to rehearse for.

---

## Why "the restore completed" is not the question

`pg_restore` exiting zero means the bytes went in. The dangerous failure is not
an empty database — that is obvious, and somebody notices. It is a restore that
is **almost** right:

| What it looks like | Why nobody catches it |
|---|---|
| A table that came back empty while the rest succeeded | The screens render. The totals are simply lower, and nobody can say by how much. |
| Three rows missing from a table of four hundred | The totals stay plausible. |
| A ledger whose sums no longer hold | Every figure on the farm is a sum over those ledgers, so the arithmetic is wrong everywhere at once — and plausible everywhere at once. |
| A migration record missing | The copy is a schema version behind. It fails on the first query touching a newer column, weeks later, for a reason that looks unrelated. |
| More rows than the source | The restore went into a database that was not empty. This is a merge, and the result belongs to neither copy. |

Each of those passes "the restore completed". Each is caught.

**These were not reasoned about and left there — each one was inflicted on a
restored copy on purpose and confirmed to be reported.** A drill that cannot
tell a broken restore from a good one is decoration.

---

## Reading the verdict

### USABLE

The dump restores, nothing is missing, every ledger adds up, and the schema is
the one the code expects. The line also tells you **how long the restore took**,
which is roughly how long the farm would be down.

### USABLE WITH PROBLEMS

Nothing is missing, but something needs attention before this copy could be
relied on. Read the SERIOUS lines. The common ones:

- **"There is no data in this database yet."** Expected before the first bird is
  placed. The drill has proved the mechanism works, not that your records
  survive it. Run it again once the farm is recording.
- **"The live database has not applied N migrations."** Not a restore problem at
  all — the live database is behind the code. Run `npx prisma migrate deploy`.
- **"The live database has no migration history."** The schema was pushed rather
  than migrated, so it cannot be rebuilt from the repository on fresh hardware.
- **"The location holds X but its batches hold Y."** Stock that appears on every
  report and can never be dispatched.

### NOT USABLE

This backup would not have saved the farm. Fix it now, while it is a drill.

---

## When it is not a drill

In order. Do not skip step 1.

1. **Stop writing to the broken database.** Take the application down. A farm
   recording into a database you are about to replace loses that work, and
   worse, cannot tell afterwards what it lost.
2. **Take a dump of the broken database anyway**, before touching anything.
   Whatever is wrong, the current state is evidence, and a second mistake during
   recovery is common.
3. **Restore into a NEW database**, never over the broken one. Give it a new
   name. If the restore turns out to be bad you still have both.
4. **Run the checks against it** before pointing the application at it:
   `npm run restore:drill -- --target <new database url>` restores a fresh dump
   there; or restore by hand and read the same verdict.
5. **Point the application at the new database** and change nothing else.
6. **Write down what was lost.** The gap between the dump and the failure is
   work that happened and is gone. Somebody has to re-enter it, and they need to
   know which day to start from.

---

## How often

Monthly is enough while the farm is being built. Weekly once it is recording,
and it should run unattended rather than when somebody remembers.

Running it on a schedule is what turns one passing drill into confidence. One
pass proves one dump taken at one moment. It says nothing about the next one.

A scheduled run needs the database URL as a secret and a Postgres to restore
into. It is deliberately **not** in the normal CI run: CI builds an empty
database every time, and a drill against an empty database proves nothing worth
the minutes.

---

## What this does NOT prove

Said plainly, because the difference between a drill and a false sense of safety
is whether its limits are written down:

- **That a backup taken at any other moment is good.** It proves one dump, taken
  now.
- **That the hosted database can be rolled back to a point in time.** Neon keeps
  its own history and that is good — but it is the same company holding the
  thing it is backing up. The `pg_dump` this drill takes is a copy the farm
  owns, restorable onto any Postgres anywhere, including after leaving the host.
  The two are not alternatives.
- **That anybody knows how to do this under pressure.** Reading this page is not
  the same as having done it. Somebody other than the person who wrote the
  software should run the drill at least once, from this page alone.

---

## What you need installed

The PostgreSQL client tools — `pg_dump`, `pg_restore`, `psql`.

```
macOS    brew install libpq      (then add its bin directory to PATH)
Ubuntu   apt install postgresql-client
```

The drill tells you this only when a tool is genuinely missing, rather than
printing install instructions underneath an unrelated SQL error.
