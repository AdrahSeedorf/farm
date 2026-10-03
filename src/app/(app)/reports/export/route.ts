import { requirePermission, currentUserCan, requireViewer } from '@/lib/session';
import { recordAudit } from '@/lib/audit';
import { db } from '@/lib/db';
import { orgFilter, siteFilter } from '@/lib/scope';
import { figuresFor, dailySeriesFor } from '@/lib/period-report-service';
import { lastCountedByLocation } from '@/lib/stock-take-service';
import { PERIODS, periodFor, reconcile, derive, daysIn, type PeriodKey } from '@/lib/period-report';
import { summaryRows, dailyRows, type ExportMeta } from '@/lib/report-export';
import { fileName, toCsv } from '@/lib/csv';

/**
 * Downloading the report — ADRAH Farms
 *
 * A ROUTE HANDLER, NOT A SERVER ACTION, because the answer is a FILE. An action
 * returns data to React; this has to return bytes with a content type and a
 * filename, which only a route can do.
 *
 * ── THE PERMISSION IS CHECKED HERE, NOT ON THE BUTTON ──────────────────────
 *
 * This URL can be typed. Hiding the download link from somebody without
 * `report:export` is a courtesy; `requirePermission` is the control, and it runs
 * before a single figure is read. The same rule as every page and action in this
 * system, and it matters more here because a file leaves the building.
 *
 * ── AND THE EXPORT IS AUDITED ──────────────────────────────────────────────
 *
 * Reading a screen is not logged; taking a copy of the farm's figures away is.
 * Not because exporting is suspicious, but because "who had the March numbers
 * before that meeting?" is a question with an answer, and it costs one row.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const principal = await requirePermission('report:export');
  const viewer = await requireViewer();

  const url = new URL(request.url);
  const key: PeriodKey = (PERIODS as readonly string[]).includes(url.searchParams.get('period') ?? '')
    ? (url.searchParams.get('period') as PeriodKey)
    : 'THIS_WEEK';

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const custom =
    from && to
      ? { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T00:00:00.000Z`) }
      : undefined;
  const valid =
    custom && !Number.isNaN(custom.from.getTime()) && !Number.isNaN(custom.to.getTime());

  const today = new Date();
  const period = periodFor(key, today, valid ? custom : undefined);

  // Which file: the summary, or the day-by-day rows behind it.
  const sheet = url.searchParams.get('sheet') === 'daily' ? 'daily' : 'summary';

  const [figures, canSeeMoney, site, counts] = await Promise.all([
    figuresFor(principal, period),
    currentUserCan('price:view'),
    db.site.findFirst({
      where: { ...orgFilter(principal), ...siteFilter(principal) },
      orderBy: { createdAt: 'asc' },
      select: { name: true },
    }),
    lastCountedByLocation(principal),
  ]);

  const meta: ExportMeta = {
    farm: site?.name ?? 'ADRAH Farms',
    takenBy: viewer.name,
    takenAt: today,
    canSeeMoney,
  };

  const lastCounted =
    counts
      .map((c) => c.lastCountedOn)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const rows =
    sheet === 'daily'
      ? dailyRows(await dailySeriesFor(principal, period), period, meta)
      : summaryRows(
          figures,
          derive(figures, daysIn(period)),
          reconcile(figures),
          period,
          meta,
          lastCounted,
        );

  await recordAudit({
    principal,
    action: 'report.export',
    entityType: 'Report',
    entityId: `${key}:${sheet}`,
    after: {
      from: period.from.toISOString().slice(0, 10),
      to: period.to.toISOString().slice(0, 10),
      sheet,
      includedMoney: canSeeMoney,
    },
  });

  const name = fileName(sheet === 'daily' ? 'day-by-day' : 'report', period.from, period.to);

  return new Response(toCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // `attachment` so the browser saves it rather than rendering it as text,
      // and the filename so two downloads of different periods do not collide
      // in a downloads folder.
      'Content-Disposition': `attachment; filename="${name}"`,
      // A report is a snapshot of ledgers that change. A cached copy served
      // tomorrow would be a different farm's week wearing today's filename.
      'Cache-Control': 'no-store',
    },
  });
}
