import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import type { HealthEventType } from '@/generated/prisma/enums';
import { orgFilter, siteFilter } from '@/lib/scope';
import {
  activeWithdrawals,
  unstatedWithdrawals,
  clearFor,
  WITHDRAWABLE_EVENT_TYPES,
  type ActiveWithdrawal,
  type UnstatedWithdrawal,
} from '@/lib/health-schedule';

/**
 * Withdrawal periods — ADRAH Farms
 *
 * After some treatments, eggs and birds must not be sold for a stated number of
 * days. This module answers one question — "may this flock's produce be sold
 * today?" — and answers it the same way everywhere it is asked.
 *
 * WHY THIS IS A SERVICE AND NOT A COLUMN
 *   A `underWithdrawalUntil` field on the flock would have to be recalculated
 *   every time a treatment was recorded, corrected or removed, and the day it
 *   fell out of step the system would confidently clear a flock that was not
 *   clear. It is derived from the events, every time, for the same reason the
 *   bird count is derived from the ledger.
 *
 * NOTHING HERE DECIDES A WITHDRAWAL PERIOD. Each one was copied off the product
 * label onto the event when it was recorded. This module only does the date
 * arithmetic and refuses to forget.
 */

export class WithdrawalError extends Error {
  readonly clearsOn: Date;
  readonly kind: 'EGGS' | 'MEAT';

  constructor(message: string, kind: 'EGGS' | 'MEAT', clearsOn: Date) {
    super(message);
    this.name = 'WithdrawalError';
    this.kind = kind;
    this.clearsOn = clearsOn;
  }
}

export interface FlockWithdrawal {
  flockId: string;
  flockCode: string;
  houseName: string | null;
  withdrawals: ActiveWithdrawal[];
  /**
   * Treatments nobody recorded a withdrawal period for.
   *
   * These restrict with NO clearing date. See `unstatedWithdrawals` — silence is
   * not the same as a label saying none applies, and this system used to treat
   * it as if it were.
   */
  unstated: UnstatedWithdrawal[];
  eggsClearOn: Date | null;
  meatClearsOn: Date | null;
  /** True while anything about this flock's produce is unknown rather than dated. */
  eggsUnknown: boolean;
}

/**
 * Every treatment with a withdrawal period, for the flocks this principal sees.
 *
 * NO DATE BOUND ON THE QUERY, deliberately. Filtering to "the last 90 days" in
 * SQL would be faster and would silently miss a 120-day period the day someone
 * recorded one. Health events are rare — a few dozen per flock per cycle — so
 * the whole set is cheap to read and the arithmetic is done where it can be
 * tested.
 */
export async function withdrawalsAcrossFlocks(
  principal: Principal,
  asOf: Date = new Date(),
): Promise<FlockWithdrawal[]> {
  const flocks = await db.animalGroup.findMany({
    where: { site: orgFilter(principal), ...siteFilter(principal), closedAt: null },
    select: {
      id: true,
      code: true,
      productionUnit: { select: { name: true } },
      /**
       * EVERY EVENT THAT COULD CARRY A PERIOD, not only those that do.
       *
       * This used to filter to rows where a withdrawal was recorded, which meant
       * a treatment with nothing recorded was never even read — the gap was
       * invisible at the database level before it was invisible in the
       * arithmetic. The set is a few dozen rows per flock; reading all of them
       * and deciding in code is both cheap and testable.
       */
      healthEvents: {
        where: { type: { in: WITHDRAWABLE_EVENT_TYPES as string[] as HealthEventType[] } },
        select: {
          name: true,
          type: true,
          occurredOn: true,
          eggWithdrawalDays: true,
          meatWithdrawalDays: true,
        },
      },
    },
  });

  return flocks
    .map((flock) => {
      const sources = flock.healthEvents.map((e) => ({ ...e, eventType: e.type as string }));
      const withdrawals = activeWithdrawals(sources, asOf);
      const unstated = unstatedWithdrawals(sources, asOf);
      return {
        flockId: flock.id,
        flockCode: flock.code,
        houseName: flock.productionUnit?.name ?? null,
        withdrawals,
        unstated,
        eggsClearOn: clearFor(withdrawals, 'EGGS'),
        meatClearsOn: clearFor(withdrawals, 'MEAT'),
        eggsUnknown: unstated.some((u) => u.kind === 'EGGS'),
      };
    })
    .filter((f) => f.withdrawals.length > 0 || f.unstated.length > 0)
    .sort((a, b) => {
      // An unknown sorts above any dated restriction: it is the one that needs
      // somebody to go and read a label, and it does not clear on its own.
      if (a.eggsUnknown !== b.eggsUnknown) return a.eggsUnknown ? -1 : 1;
      const latest = (f: { withdrawals: ActiveWithdrawal[] }) =>
        f.withdrawals.length === 0
          ? 0
          : Math.max(...f.withdrawals.map((w) => w.clearsOn.getTime()));
      return latest(b) - latest(a);
    });
}

/** One flock's active restrictions. */
export async function flockWithdrawals(
  principal: Principal,
  flockId: string,
  asOf: Date = new Date(),
): Promise<FlockWithdrawal | null> {
  const flock = await db.animalGroup.findFirst({
    where: { id: flockId, site: orgFilter(principal) },
    select: {
      id: true,
      code: true,
      productionUnit: { select: { name: true } },
      // Same set as withdrawalsAcrossFlocks, for the same reason: a treatment
      // with no period recorded is exactly the row that must not be filtered out.
      healthEvents: {
        where: { type: { in: WITHDRAWABLE_EVENT_TYPES as string[] as HealthEventType[] } },
        select: {
          name: true,
          type: true,
          occurredOn: true,
          eggWithdrawalDays: true,
          meatWithdrawalDays: true,
        },
      },
    },
  });
  if (!flock) return null;

  const sources = flock.healthEvents.map((e) => ({ ...e, eventType: e.type as string }));
  const withdrawals = activeWithdrawals(sources, asOf);
  const unstated = unstatedWithdrawals(sources, asOf);
  return {
    flockId: flock.id,
    flockCode: flock.code,
    houseName: flock.productionUnit?.name ?? null,
    withdrawals,
    unstated,
    eggsClearOn: clearFor(withdrawals, 'EGGS'),
    meatClearsOn: clearFor(withdrawals, 'MEAT'),
    eggsUnknown: unstated.some((u) => u.kind === 'EGGS'),
  };
}

/**
 * THE GATE. Throws if this flock's produce may not be sold today.
 *
 * NOTHING CALLS THIS YET — sales arrive at Milestone 15 and egg production at
 * Milestone 9. It is written now, with the treatment that creates the
 * restriction, because a rule added afterwards is a rule with a hole in it
 * exactly where the first few months of trading were.
 *
 * When the order screen exists, it calls this before a line is accepted. The
 * error carries the clearing date so the message can say when, not just no.
 */
export async function assertSaleAllowed(
  principal: Principal,
  flockId: string,
  kind: 'EGGS' | 'MEAT',
  asOf: Date = new Date(),
): Promise<void> {
  const state = await flockWithdrawals(principal, flockId, asOf);
  if (!state) return;

  const clearsOn = kind === 'EGGS' ? state.eggsClearOn : state.meatClearsOn;
  if (!clearsOn) return;

  const blocking = state.withdrawals.filter((w) => w.kind === kind);
  const names = [...new Set(blocking.map((w) => w.name))].join(', ');
  const what = kind === 'EGGS' ? 'Eggs' : 'Birds';

  throw new WithdrawalError(
    `${what} from ${state.houseName ?? state.flockCode} cannot be sold until ` +
      `${clearsOn.toISOString().slice(0, 10)} — withdrawal period after ${names}.`,
    kind,
    clearsOn,
  );
}

/** The same question, answered without throwing, for rendering a screen. */
export async function saleAllowed(
  principal: Principal,
  flockId: string,
  kind: 'EGGS' | 'MEAT',
  asOf: Date = new Date(),
): Promise<{ allowed: boolean; clearsOn: Date | null }> {
  const state = await flockWithdrawals(principal, flockId, asOf);
  const clearsOn = !state ? null : kind === 'EGGS' ? state.eggsClearOn : state.meatClearsOn;
  return { allowed: clearsOn === null, clearsOn };
}
