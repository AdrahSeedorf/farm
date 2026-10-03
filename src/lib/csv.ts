import { formatGHS, type Pesewas } from '@/lib/money';

/**
 * CSV — ADRAH Farms
 *
 * A pure writer. It knows nothing about reports, flocks or money beyond how to
 * render a cell safely, and it is deliberately small enough to read in one go.
 *
 * ── WHY THIS IS NOT `rows.map(r => r.join(','))` ───────────────────────────
 *
 * Three things break that one-liner, and all three are real on this farm:
 *
 *   A COMMA IN A VALUE. "Obeng Stores, Kumasi" is a buyer name somebody will
 *   type, and unquoted it silently becomes two columns. Every row after it is
 *   misaligned, and the file still opens.
 *
 *   A NEWLINE IN A VALUE. The note field on a stock count is free text and
 *   people press Enter in it. Unquoted, one record becomes two, and the second
 *   is garbage with a valid-looking shape.
 *
 *   A VALUE THAT A SPREADSHEET EXECUTES. See `neutralise` below. This is the
 *   one that is not merely a formatting bug.
 *
 * ── AND WHY MONEY GOES THROUGH ITS OWN FUNCTION ────────────────────────────
 *
 * Everything in this system stores money as integer pesewas precisely so no
 * float ever touches a cedi figure. A CSV is read in Excel, where a column of
 * cedis is summed — so it must carry exact decimal cedis, converted from the
 * integer once, here, rather than by whoever writes the next export.
 */

/**
 * NEUTRALISING A CELL A SPREADSHEET WOULD EXECUTE.
 *
 * Excel, LibreOffice and Google Sheets treat a cell beginning with `=`, `+`,
 * `-`, `@`, or a tab or carriage return, as a FORMULA. A buyer who names
 * themselves `=HYPERLINK("http://...","Click")` — or worse, something that
 * shells out — has written code into a file the farm will open and may email to
 * its accountant. This is a known attack class (CSV or formula injection), and
 * nothing else in the pipeline defends against it: the database is storing the
 * name correctly, and the browser displays it harmlessly.
 *
 * The fix is to prefix a single quote, which every major spreadsheet reads as
 * "treat the rest as text". The cell still shows what the person typed, which
 * matters — a farm looking for a buyer called "+233 Traders" must still find it.
 *
 * A LEADING `-` IS A HARD CASE, because `-6` is a legitimate negative number and
 * a stock variance column is full of them. So a cell that parses as a plain
 * number is left alone; only text that happens to start with a dash is quoted.
 */
const DANGEROUS_FIRST = ['=', '+', '-', '@', '\t', '\r'];

export function neutralise(value: string): string {
  if (value.length === 0) return value;
  if (!DANGEROUS_FIRST.includes(value[0])) return value;

  // A real number is not a formula. `-6`, `-0.5`, `+12` are data.
  if (/^[+-]?\d+(\.\d+)?$/.test(value)) return value;

  return `'${value}`;
}

/**
 * One cell, quoted only where it has to be.
 *
 * Quoting everything would be simpler and is what many writers do, but it makes
 * the file unreadable to a human opening it in a text editor — which somebody
 * will, the first time a column looks wrong.
 */
export function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';

  const text = neutralise(String(value));
  if (!/[",\n\r]/.test(text)) return text;

  // RFC 4180: wrap in quotes, and double any quote inside.
  return `"${text.replace(/"/g, '""')}"`;
}

export function row(values: (string | number | null | undefined)[]): string {
  return values.map(cell).join(',');
}

/**
 * The whole file.
 *
 * CRLF LINE ENDINGS, which RFC 4180 specifies and Excel on Windows needs to
 * split rows at all. Every other tool accepts them.
 *
 * A BYTE ORDER MARK leads the file. Without it, Excel opens a UTF-8 CSV as the
 * system's legacy codepage, and every name on this farm with a Ghanaian
 * character in it — Obeng-Mireku is fine, but Akosua Asantewaa's "ɛ" and the
 * cedi sign are not — arrives mangled. The BOM costs three bytes and is the
 * difference between a readable file and a support call.
 */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map(row).join('\r\n') + '\r\n';
}

/**
 * Money, as exact decimal cedis.
 *
 * NOT `formatGHS`, which produces "GHS 1,250.00" for a screen. A thousands
 * separator inside a CSV cell is a comma that quoting survives but that Excel
 * then refuses to read as a number, so the column cannot be summed — which is
 * the only reason anybody exported it.
 *
 * Integer division, so no float ever touches it.
 */
export function cedis(pesewas: Pesewas | number | null): string {
  if (pesewas === null) return '';
  const value = Number(pesewas);
  const negative = value < 0;
  const abs = Math.abs(Math.trunc(value));
  const whole = Math.floor(abs / 100);
  const part = abs % 100;
  return `${negative ? '-' : ''}${whole}.${String(part).padStart(2, '0')}`;
}

/** A date as a spreadsheet will sort it. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The header block every export carries.
 *
 * A CSV WITH NO PROVENANCE IS A FILE SOMEBODY ARGUES ABOUT IN A YEAR. Which
 * farm, which dates, when it was taken and by whom — without those, two
 * versions of the same report cannot be told apart, and the one in the email
 * wins the argument regardless of which is right.
 *
 * It also states what the figures are NOT, where that matters. The same
 * sentences are on the screen; a file that travels away from the screen has to
 * carry them.
 */
export function provenance(args: {
  title: string;
  farm: string;
  from: Date;
  to: Date;
  takenBy: string;
  takenAt: Date;
  notes?: string[];
}): (string | number | null)[][] {
  return [
    [args.title],
    ['Farm', args.farm],
    ['From', isoDate(args.from)],
    ['To', isoDate(args.to)],
    ['Taken by', args.takenBy],
    ['Taken at', args.takenAt.toISOString()],
    ...(args.notes ?? []).map((note) => ['Note', note] as (string | null)[]),
    [],
  ];
}

/** `adrah-report-2026-10-01-to-2026-10-07.csv` */
export function fileName(stem: string, from: Date, to: Date): string {
  return `adrah-${stem}-${isoDate(from)}-to-${isoDate(to)}.csv`;
}

/**
 * Kept so the screen and the file cannot drift: anything formatted for display
 * uses `formatGHS`, anything for a spreadsheet uses `cedis`, and this re-export
 * is the reminder that they are two different jobs.
 */
export { formatGHS };
