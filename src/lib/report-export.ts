import { cedis, isoDate, provenance } from '@/lib/csv';
import {
  BASIS,
  daysIn,
  type DerivedFigures,
  type Period,
  type PeriodFigures,
  type Reconciliation,
} from '@/lib/period-report';

/**
 * Shaping the period report into rows — ADRAH Farms
 *
 * PURE, AND SEPARATE FROM THE ROUTE, so what the file contains can be tested
 * without a browser, a session or a database. The route's only job is to decide
 * who may have it and hand back bytes.
 *
 * ── ONE ROW PER FIGURE, WITH ITS BASIS ─────────────────────────────────────
 *
 * Not a wide row of twenty columns. A farm exporting this is taking it to an
 * accountant, a bank or a buyer, and the question that follows every figure is
 * "where did that come from?". `BASIS` already answers that on the screen; a
 * file that travels away from the screen has to carry the answer with it, or
 * the first person to query a number has nothing to check it against.
 *
 * ── MONEY IS OMITTED, NOT BLANKED ──────────────────────────────────────────
 *
 * A supervisor holds `report:export` and no `price:view`. Writing the money rows
 * with empty cells would tell them exactly how many money figures exist and
 * what they are called, and would produce a file that looks damaged rather than
 * restricted. The rows are left out entirely and the header says so, which is
 * both honest and quieter.
 */

export interface ExportMeta {
  farm: string;
  takenBy: string;
  takenAt: Date;
  canSeeMoney: boolean;
}

type Row = (string | number | null)[];

/**
 * The caveats the screen says out loud, carried into the file.
 *
 * EVERY ONE OF THESE IS A SENTENCE SOMEBODY WOULD OTHERWISE SUPPLY THEMSELVES,
 * wrongly. "Feed cost per egg" read as "cost per egg" is how a farm prices below
 * its own costs; "agreed" read as "received" is how it thinks it has been paid.
 */
export function exportNotes(meta: ExportMeta, lastCountedOn: Date | null): string[] {
  const notes = [
    'Every figure here is derived from the recorded ledgers. Nothing is estimated and nothing is stored as a total.',
    lastCountedOn === null
      ? 'Nobody has counted the store, so these figures are the records agreeing with the records. Only a stock count compares them to a shelf.'
      : `A store was last counted ${isoDate(
          lastCountedOn,
        )}. Figures after that date are the records agreeing with the records until the next count.`,
  ];

  if (meta.canSeeMoney) {
    notes.push(
      'Feed cost per egg is FEED ONLY — no labour, no depreciation, no share of the pullets. It is not the cost per egg.',
      'Sales are what was AGREED on confirmed orders. Money received is recorded separately and is not in this file.',
    );
  } else {
    notes.push(
      'Money figures are not included in this file, because the person who took it does not have permission to see prices.',
    );
  }

  return notes;
}

/**
 * The summary: one row per figure, each with where it came from.
 */
export function summaryRows(
  figures: PeriodFigures,
  derived: DerivedFigures,
  check: Reconciliation,
  period: Period,
  meta: ExportMeta,
  lastCountedOn: Date | null,
): Row[] {
  const rows: Row[] = [
    ...provenance({
      title: 'ADRAH Farms — period report',
      farm: meta.farm,
      from: period.from,
      to: period.to,
      takenBy: meta.takenBy,
      takenAt: meta.takenAt,
      notes: exportNotes(meta, lastCountedOn),
    }),
    ['Figure', 'Value', 'Unit', 'Where it came from'],
    ['Days in period', daysIn(period), 'days', 'The dates above, inclusive.'],

    ['Eggs collected', figures.collected, 'eggs', BASIS.collected],
    ['Of those, saleable', figures.saleable, 'eggs', BASIS.saleable],
    ['Of those, held as stock', figures.collectedHeld, 'eggs', BASIS.collectedHeld],
    ['Into the store', figures.intoStore, 'eggs', BASIS.intoStore],
    ['Out of the store', figures.outOfStore, 'eggs', BASIS.outOfStore],
    ['Wasted', figures.wasted, 'eggs', BASIS.wasted],
    ['Stock at the start', figures.openingStock, 'eggs', BASIS.stock],
    ['Stock at the end', figures.closingStock, 'eggs', BASIS.stock],
    ['Dispatched', figures.dispatched, 'eggs', 'Packs on confirmed loads, converted to eggs.'],
    ['Loads', figures.loads, 'loads', 'Confirmed dispatches in the period.'],

    ['Birds at the start', figures.openingBirds, 'birds', 'The population ledger on the day before.'],
    ['Birds at the end', figures.closingBirds, 'birds', 'The population ledger on the last day.'],
    ['Died', figures.deaths, 'birds', 'Mortality events in the period.'],
    ['Culled', figures.culls, 'birds', 'Cull events in the period.'],
    ['Feed issued', figures.feedKg, 'kg', 'Feed issues from the store to a house.'],

    ['Hen-day production', derived.henDayPct, '%', 'Eggs ÷ average birds alive ÷ days × 100.'],
    ['Saleable share', derived.saleablePct, '%', 'Saleable eggs ÷ all eggs collected × 100.'],
    ['Loss', derived.lossPct, '%', 'Deaths and culls ÷ birds at the start × 100.'],
    [
      'Feed per bird per day',
      derived.feedPerBirdGrams,
      'g',
      'Feed issued ÷ average birds alive ÷ days.',
    ],
    ['Unsold', derived.unsold, 'eggs', 'Collected less dispatched. A real number, not a failure.'],
  ];

  if (meta.canSeeMoney) {
    rows.push(
      ['Agreed on loads', cedis(figures.agreedPesewas), 'GHS', 'What confirmed orders were agreed at. NOT money received.'],
      ['Feed cost', cedis(figures.feedPesewas), 'GHS', 'The cost of the feed issued, from the batches it came out of.'],
      [
        'Feed cost per egg',
        cedis(derived.feedCostPerEgg),
        'GHS',
        'Feed cost ÷ eggs collected. FEED ONLY — not the cost per egg.',
      ],
    );
  }

  rows.push(
    [],
    ['Reconciliation', '', '', 'The one thing only this system can do: check two separate ledgers against each other.'],
    ['Counted in the houses', check.countedInHouses, 'eggs', 'From the production ledger.'],
    ['Reached the store', check.reachedStore, 'eggs', 'From the stock ledger.'],
    ['Gap', check.gap, 'eggs', check.sentence],
    [
      'Collected but held by nobody',
      check.notHeldAsStock,
      'eggs',
      'Grades that are not linked to a store item — cracked and floor eggs, usually. Explained, not a gap.',
    ],
  );

  return rows;
}

export interface DayRow {
  onDate: Date;
  ageDays: number | null;
  flockCode: string;
  openingBirds: number;
  closingBirds: number;
  deaths: number;
  culls: number;
  collected: number;
  saleable: number;
  feedKg: number;
}

/**
 * The daily series: one row per day per flock.
 *
 * THIS IS THE ONE SOMEBODY ACTUALLY WANTS. The summary is a page of answers; the
 * daily rows are the material to ask a different question with, which is why
 * anybody opens a spreadsheet in the first place. It carries no money at all —
 * not as a restriction, but because there is no daily money figure that is not
 * an allocation somebody would have to explain.
 */
export function dailyRows(days: DayRow[], period: Period, meta: ExportMeta): Row[] {
  return [
    ...provenance({
      title: 'ADRAH Farms — day by day',
      farm: meta.farm,
      from: period.from,
      to: period.to,
      takenBy: meta.takenBy,
      takenAt: meta.takenAt,
      notes: [
        'One row per house per day. A day with no record is absent rather than zero — nothing was written down, which is not the same as nothing happening.',
        'No money figures: there is no daily cost that is not an allocation somebody would have to explain.',
      ],
    }),
    [
      'Date',
      'House',
      'Age (days)',
      'Birds at start',
      'Birds at end',
      'Died',
      'Culled',
      'Eggs collected',
      'Of those, saleable',
      'Feed issued (kg)',
    ],
    ...days.map((day) => [
      isoDate(day.onDate),
      day.flockCode,
      day.ageDays,
      day.openingBirds,
      day.closingBirds,
      day.deaths,
      day.culls,
      day.collected,
      day.saleable,
      day.feedKg,
    ]),
  ];
}
