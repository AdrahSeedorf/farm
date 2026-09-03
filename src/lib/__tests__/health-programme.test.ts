import { describe, it, expect } from 'vitest';
import {
  parseProgrammeTable,
  parseRoute,
  checkProgramme,
  approvalNote,
  ROUTE_LABELS,
  ROUTES,
} from '../health-programme';
import { programmeItemSchema, approvalSchema } from '../validation/health';

/**
 * NOTE ON THE FIGURES BELOW.
 *
 * Every age, dose and withdrawal period in this file is an arbitrary fixture,
 * chosen so the parsing is easy to check by eye. None of it is a schedule and
 * none of it is advice — the module under test contains no clinical content, and
 * neither do its tests.
 */

describe('reading a route someone wrote by hand', () => {
  it('accepts the spellings a vet actually writes', () => {
    expect(parseRoute('eye drop')).toBe('EYE_DROP');
    expect(parseRoute('Eye-drop')).toBe('EYE_DROP');
    expect(parseRoute('OCULAR')).toBe('EYE_DROP');
    expect(parseRoute('drinking water')).toBe('DRINKING_WATER');
    expect(parseRoute('DW')).toBe('DRINKING_WATER');
    expect(parseRoute('wing web')).toBe('WING_WEB');
    expect(parseRoute('s/c')).toBe('INJECTION_SUBCUTANEOUS');
    expect(parseRoute('IM')).toBe('INJECTION_INTRAMUSCULAR');
  });

  it('passes through a stored value unchanged', () => {
    expect(parseRoute('DRINKING_WATER')).toBe('DRINKING_WATER');
  });

  it('returns null for something it does not know, rather than guessing', () => {
    expect(parseRoute('by the usual method')).toBeNull();
    expect(parseRoute('')).toBeNull();
  });

  it('has a label for every stored route', () => {
    for (const r of ROUTES) expect(ROUTE_LABELS[r].length).toBeGreaterThan(0);
  });
});

describe('reading a programme table', () => {
  it('reads a plain table', () => {
    const r = parseProgrammeTable(`ageDays,name,route,dosePerBird
7,Newcastle,eye drop,1
14,Gumboro,drinking water,1
35,Fowl pox,wing web,1`);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.ageDays, x.name, x.route])).toEqual([
      [7, 'Newcastle', 'EYE_DROP'],
      [14, 'Gumboro', 'DRINKING_WATER'],
      [35, 'Fowl pox', 'WING_WEB'],
    ]);
  });

  it('reads a WEEKS column and converts, because vets write both', () => {
    const r = parseProgrammeTable(`week,name
1,A
6,B
16,C`);
    expect(r.rows.map((x) => x.ageDays)).toEqual([7, 42, 112]);
    expect(r.warnings.some((w) => /WEEKS/.test(w.message))).toBe(true);
  });

  it('accepts tabs and untidy headers', () => {
    const r = parseProgrammeTable(`Age (days)\tVaccine\tMethod
7\tNewcastle\tEye drop`);
    expect(r.errors).toEqual([]);
    expect(r.rows[0].route).toBe('EYE_DROP');
  });

  it('sorts by age whatever order the table was in', () => {
    const r = parseProgrammeTable(`ageDays,name
35,C
7,A
14,B`);
    expect(r.rows.map((x) => x.name)).toEqual(['A', 'B', 'C']);
    expect(r.rows.map((x) => x.sortOrder)).toEqual([0, 1, 2]);
  });

  it('reads withdrawal periods, and keeps blank as blank', () => {
    const r = parseProgrammeTable(`ageDays,name,type,eggWithdrawalDays,meatWithdrawalDays
100,Antibiotic,MEDICATION,7,10
110,Vitamin,SUPPLEMENT,,`);
    expect(r.rows[0].eggWithdrawalDays).toBe(7);
    expect(r.rows[0].meatWithdrawalDays).toBe(10);
    // Blank is NOT zero: nobody wrote a period down, which is not a claim that
    // none applies.
    expect(r.rows[1].eggWithdrawalDays).toBeNull();
  });

  it('defaults the window rather than demanding one', () => {
    expect(parseProgrammeTable(`ageDays,name\n7,A`).rows[0].windowDays).toBe(2);
    expect(parseProgrammeTable(`ageDays,name,window\n7,A,5`).rows[0].windowDays).toBe(5);
  });

  describe('refusing to guess', () => {
    it('names the line it cannot read', () => {
      const r = parseProgrammeTable(`ageDays,name
7,Newcastle
about a week,Gumboro`);
      expect(r.errors.join(' ')).toMatch(/Line 3/);
      expect(r.rows).toHaveLength(1);
    });

    it('rejects a row with no name — what is being given?', () => {
      const r = parseProgrammeTable(`ageDays,name\n7,`);
      expect(r.errors.join(' ')).toMatch(/no name/);
    });

    it('rejects a table with no age column', () => {
      expect(parseProgrammeTable(`vaccine,route\nNewcastle,eye`).errors.join(' ')).toMatch(
        /No age column/,
      );
    });

    it('rejects a table with no name column', () => {
      expect(parseProgrammeTable(`ageDays,route\n7,eye`).errors.join(' ')).toMatch(
        /No name column/,
      );
    });

    it('records an unreadable route as Other and SAYS SO', () => {
      const r = parseProgrammeTable(`ageDays,name,route\n7,A,by the usual method`);
      expect(r.rows[0].route).toBe('OTHER');
      expect(r.warnings.some((w) => /could not read the route/.test(w.message))).toBe(true);
    });
  });
});

describe('catching a transcription mistake', () => {
  it('notices a row pasted twice', () => {
    const r = parseProgrammeTable(`ageDays,name
7,Newcastle
7,Newcastle
21,Gumboro
35,Fowl pox`);
    expect(r.warnings.some((w) => /appears 2 times on day 7/.test(w.message))).toBe(true);
  });

  it('NOTICES AN AGE COLUMN READ IN THE WRONG UNIT', () => {
    // A whole programme finishing by day 18 is almost certainly eighteen WEEKS.
    // This is the single most consequential transcription error possible here:
    // it would put every reminder seven times too early.
    const r = parseProgrammeTable(`ageDays,name
1,A
6,B
10,C
18,D`);
    expect(r.warnings.some((w) => /seven times too small/.test(w.message))).toBe(true);
  });

  it('does not cry wolf on a real programme that runs into lay', () => {
    const r = parseProgrammeTable(`ageDays,name
7,A
21,B
70,C
119,D`);
    expect(r.warnings.some((w) => /seven times too small/.test(w.message))).toBe(false);
  });

  it('notices an age past two years', () => {
    const r = parseProgrammeTable(`ageDays,name\n7,A\n900,B`);
    expect(r.warnings.some((w) => /past two years/.test(w.message))).toBe(true);
  });

  it('notices a medication with no withdrawal period recorded', () => {
    const r = parseProgrammeTable(`ageDays,name,type
100,Antibiotic,MEDICATION
110,Another,TREATMENT`);
    const w = r.warnings.find((x) => x.field === 'withdrawal');
    expect(w?.message).toMatch(/2 medication or treatment entries have no withdrawal/);
    expect(w?.message).toMatch(/not that none applies/);
  });

  it('says nothing about a vaccination with no withdrawal', () => {
    const r = parseProgrammeTable(`ageDays,name,type\n7,Newcastle,VACCINATION`);
    expect(r.warnings.some((x) => x.field === 'withdrawal')).toBe(false);
  });

  it('says nothing at all about an empty programme', () => {
    expect(checkProgramme([])).toEqual([]);
  });
});

describe('what the screen says about approval', () => {
  const base = {
    status: 'DRAFT' as const,
    approvedByName: null,
    approvedByRole: null,
    approvedOn: null,
    sourceName: null,
  };

  it('says plainly that nobody has reviewed a draft', () => {
    expect(approvalNote(base)).toMatch(/Provisional — no veterinarian has reviewed this yet/);
  });

  it('and that it can still be used, so nobody is blocked', () => {
    expect(approvalNote(base)).toMatch(/can still be used/);
  });

  it('names where a draft came from, when that is known', () => {
    expect(approvalNote({ ...base, sourceName: 'Akate Farms' })).toMatch(/came from Akate Farms/);
  });

  it('names the vet and the date once reviewed', () => {
    expect(
      approvalNote({
        status: 'APPROVED',
        approvedByName: 'Dr Mensah',
        approvedByRole: 'Veterinary Officer',
        approvedOn: new Date('2026-09-01T00:00:00.000Z'),
        sourceName: 'Akate Farms',
      }),
    ).toBe('Approved by Dr Mensah, Veterinary Officer on 2026-09-01.');
  });

  it('falls back to provisional if the status says approved but no name was kept', () => {
    // Belt and braces: an approval with nobody's name on it is not oversight.
    expect(approvalNote({ ...base, status: 'APPROVED' })).toMatch(/Provisional/);
  });
});

describe('adding one entry by hand', () => {
  const form = (over: Record<string, string> = {}) => ({
    ageDays: '7',
    name: 'Newcastle (La Sota)',
    eventType: 'VACCINATION',
    route: 'EYE_DROP',
    ...over,
  });

  it('accepts a plain entry', () => {
    const r = programmeItemSchema.safeParse(form());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.windowDays).toBe(2);
      expect(r.data.eggWithdrawalDays).toBeNull();
    }
  });

  it('accepts day zero — a great deal happens at the hatchery', () => {
    expect(programmeItemSchema.safeParse(form({ ageDays: '0' })).success).toBe(true);
  });

  it('refuses a fractional age', () => {
    expect(programmeItemSchema.safeParse(form({ ageDays: '7.5' })).success).toBe(false);
  });

  it('BLANK WITHDRAWAL IS NOT ZERO', () => {
    const blank = programmeItemSchema.safeParse(form({ eggWithdrawalDays: '' }));
    expect(blank.success && blank.data.eggWithdrawalDays).toBeNull();
    const zero = programmeItemSchema.safeParse(form({ eggWithdrawalDays: '0' }));
    expect(zero.success && zero.data.eggWithdrawalDays).toBe(0);
  });

  it('refuses a dose of zero, which would mean nothing was given', () => {
    expect(programmeItemSchema.safeParse(form({ dosePerBird: '0' })).success).toBe(false);
  });
});

describe('recording a review', () => {
  const today = new Date().toISOString().slice(0, 10);

  it('requires a name — approval by nobody is a checkbox, not oversight', () => {
    expect(approvalSchema.safeParse({ approvedByName: '', approvedOn: today }).success).toBe(
      false,
    );
  });

  it('accepts a named vet and a date', () => {
    const r = approvalSchema.safeParse({
      approvedByName: 'Dr Mensah',
      approvedByRole: 'Veterinary Officer',
      approvedOn: today,
    });
    expect(r.success).toBe(true);
  });

  it('refuses a review dated in the future', () => {
    expect(
      approvalSchema.safeParse({ approvedByName: 'Dr Mensah', approvedOn: '2099-01-01' }).success,
    ).toBe(false);
  });
});
