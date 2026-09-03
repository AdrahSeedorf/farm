import 'server-only';
import { db } from '@/lib/db';
import type { Principal } from '@/lib/rbac';
import { orgFilter, siteFilter } from '@/lib/scope';
import {
  activeWithdrawals,
  clearFor,
  type ActiveWithdrawal,
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
  eggsClearOn: Date | null;
  meatClearsOn: Date | null;
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
      healthEvents: {
        where: {
          OR: [{ eggWithdrawalDays: { not: null } }, { meatWithdrawalDays: { not: null } }],
        },
        select: {
          name: true,
          occurredOn: true,
          eggWithdrawalDays: true,
          meatWithdrawalDays: true,
        },
      },
    },
  });

  return flocks
    .map((flock) => {
      const withdrawals = activeWithdrawals(flock.healthEvents, asOf);
      return {
        flockId: flock.id,
        flockCode: flock.code,
        houseName: flock.productionUnit?.name ?? null,
        withdrawals,
        eggsClearOn: clearFor(withdrawals, 'EGGS'),
        meatClearsOn: clearFor(withdrawals, 'MEAT'),
      };
    })
    .filter((f) => f.withdrawals.length > 0)
    .sort((a, b) => {
      const aLatest = Math.max(...a.withdrawals.map((w) => w.clearsOn.getTime()));
      const bLatest = Math.max(...b.withdrawals.map((w) => w.clearsOn.getTime()));
      return bLatest - aLatest;
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
      healthEvents: {
        where: {
          OR: [{ eggWithdrawalDays: { not: null } }, { meatWithdrawalDays: { not: null } }],
        },
        select: {
          name: true,
          occurredOn: true,
          eggWithdrawalDays: true,
          meatWithdrawalDays: true,
        },
      },
    },
  });
  if (!flock) return null;

  const withdrawals = activeWithdrawals(flock.healthEvents, asOf);
  return {
    flockId: flock.id,
    flockCode: flock.code,
    houseName: flock.productionUnit?.name ?? null,
    withdrawals,
    eggsClearOn: clearFor(withdrawals, 'EGGS'),
    meatClearsOn: clearFor(withdrawals, 'MEAT'),
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
