import { describe, expect, it } from 'vitest';
import {
  cedis,
  cell,
  fileName,
  isoDate,
  neutralise,
  provenance,
  row,
  toCsv,
} from '@/lib/csv';

describe('escaping a cell', () => {
  it('leaves an ordinary value alone, so the file stays readable by eye', () => {
    expect(cell('Layer mash')).toBe('Layer mash');
    expect(cell(42)).toBe('42');
  });

  it('quotes a value containing a comma', () => {
    // "Obeng Stores, Kumasi" unquoted becomes two columns, and every row after
    // it is misaligned while the file still opens.
    expect(cell('Obeng Stores, Kumasi')).toBe('"Obeng Stores, Kumasi"');
  });

  it('quotes a value containing a newline', () => {
    // The note on a stock count is free text and people press Enter in it.
    expect(cell('counted twice\nsecond count stands')).toBe(
      '"counted twice\nsecond count stands"',
    );
  });

  it('doubles a quote inside a quoted value, per RFC 4180', () => {
    expect(cell('she said "short by one"')).toBe('"she said ""short by one"""');
  });

  it('writes null and undefined as empty, not as the word null', () => {
    expect(cell(null)).toBe('');
    expect(cell(undefined)).toBe('');
  });

  it('keeps an empty string empty', () => {
    expect(cell('')).toBe('');
  });
});

/**
 * THE ONE THAT IS NOT A FORMATTING BUG.
 *
 * A spreadsheet executes a cell beginning with =, +, - or @. A buyer named
 * `=HYPERLINK(...)` has written code into a file this farm will open and may
 * email to its accountant. Nothing else in the pipeline defends against it — the
 * database stores the name correctly and the browser shows it harmlessly.
 */
describe('neutralising a cell a spreadsheet would execute', () => {
  it('defuses a formula', () => {
    expect(neutralise('=1+1')).toBe("'=1+1");
    expect(neutralise('=HYPERLINK("http://x","Click")')).toBe(
      '\'=HYPERLINK("http://x","Click")',
    );
  });

  it('defuses the other three leading characters a spreadsheet acts on', () => {
    expect(neutralise('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralise('+cmd|calc')).toBe("'+cmd|calc");
    expect(neutralise('-cmd|calc')).toBe("'-cmd|calc");
  });

  it('defuses a leading tab or carriage return, which are also formula starts', () => {
    expect(neutralise('\t=1+1')).toBe("'\t=1+1");
    expect(neutralise('\r=1+1')).toBe("'\r=1+1");
  });

  /**
   * THE HARD CASE. A stock variance column is full of negative numbers and a
   * quoted "-6" is not a number a spreadsheet can sum — which would break the
   * only reason anybody exported it.
   */
  it('leaves a real negative number alone, because -6 is data', () => {
    expect(neutralise('-6')).toBe('-6');
    expect(neutralise('-0.5')).toBe('-0.5');
    expect(neutralise('+12')).toBe('+12');
  });

  it('still defuses text that merely starts like a number', () => {
    expect(neutralise('-6 crates short')).toBe("'-6 crates short");
  });

  it('shows the person what they typed, so a search for it still finds it', () => {
    // The quote tells the spreadsheet "this is text"; it is not displayed.
    expect(neutralise('+233 Traders')).toContain('+233 Traders');
  });

  it('leaves an empty value alone rather than indexing past the end', () => {
    expect(neutralise('')).toBe('');
  });

  it('runs on every cell, not only ones the caller remembers', () => {
    expect(cell('=1+1')).toBe("'=1+1");
    expect(row(['ok', '=1+1'])).toBe("ok,'=1+1");
  });

  it('quotes AND defuses a value that needs both', () => {
    expect(cell('=A1,B1')).toBe('"\'=A1,B1"');
  });
});

describe('the file', () => {
  it('joins rows with CRLF, which is what Excel on Windows splits on', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']])).toBe('﻿a,b\r\nc,d\r\n');
  });

  it('leads with a byte order mark so Ghanaian characters survive Excel', () => {
    expect(toCsv([['Akosua Asantewaa']]).startsWith('﻿')).toBe(true);
  });

  it('ends with a line break, so appending does not corrupt the last row', () => {
    expect(toCsv([['a']]).endsWith('\r\n')).toBe(true);
  });
});

describe('money in a spreadsheet', () => {
  it('is exact decimal cedis, converted from integer pesewas', () => {
    expect(cedis(45000)).toBe('450.00');
    expect(cedis(45050)).toBe('450.50');
    expect(cedis(5)).toBe('0.05');
  });

  it('carries NO thousands separator, so the column can actually be summed', () => {
    // A comma inside the cell survives quoting and then stops Excel reading it
    // as a number — which is the only reason anybody exported it.
    expect(cedis(125000)).toBe('1250.00');
    expect(cedis(125000)).not.toContain(',');
  });

  it('handles a negative without losing the pesewas', () => {
    expect(cedis(-45050)).toBe('-450.50');
  });

  it('writes nothing for a figure that does not exist', () => {
    // Zero and "not known" are different, and a CSV must not merge them.
    expect(cedis(null)).toBe('');
    expect(cedis(0)).toBe('0.00');
  });

  it('never produces a float artefact', () => {
    for (const p of [1, 7, 99, 101, 999, 100000, 123456789]) {
      expect(cedis(p)).toMatch(/^\d+\.\d{2}$/);
    }
  });
});

describe('provenance', () => {
  const args = {
    title: 'Period report',
    farm: 'Main Farm',
    from: new Date('2026-10-01T00:00:00Z'),
    to: new Date('2026-10-07T00:00:00Z'),
    takenBy: 'Owner',
    takenAt: new Date('2026-10-08T09:30:00Z'),
  };

  it('names the farm, the dates, who took it and when', () => {
    const text = toCsv(provenance(args));
    expect(text).toMatch(/Period report/);
    expect(text).toMatch(/Main Farm/);
    expect(text).toMatch(/2026-10-01/);
    expect(text).toMatch(/2026-10-07/);
    expect(text).toMatch(/Owner/);
  });

  it('carries the caveats that are on the screen, because the file travels', () => {
    const text = toCsv(
      provenance({ ...args, notes: ['Feed only. Not the full cost per egg.'] }),
    );
    expect(text).toMatch(/Feed only/);
  });

  it('ends with a blank row, so the figures start cleanly', () => {
    const rows = provenance(args);
    expect(rows[rows.length - 1]).toEqual([]);
  });
});

describe('the file name', () => {
  it('carries the farm, the stem and the dates, so two downloads do not collide', () => {
    expect(
      fileName('report', new Date('2026-10-01T00:00:00Z'), new Date('2026-10-07T00:00:00Z')),
    ).toBe('adrah-report-2026-10-01-to-2026-10-07.csv');
  });

  it('writes dates the way a file listing sorts them', () => {
    expect(isoDate(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
  });
});
