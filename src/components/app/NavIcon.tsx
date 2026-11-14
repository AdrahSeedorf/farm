/**
 * Navigation icons — ADRAH Farms
 *
 * ── WHY THESE ARE DRAWN HERE AND NOT INSTALLED ─────────────────────────────
 *
 * An icon library is a dependency, a bundle, and a licence, for twenty-three
 * pictures that never change. These are twenty-three paths. The brief says not
 * to add a technology because it is available, and this is the clearest case of
 * it in the whole application.
 *
 * ── WHAT AN ICON IS FOR HERE, AND WHAT IT IS NOT ───────────────────────────
 *
 * It is a SECOND signal beside the word, so a row can be found by shape at a
 * glance once somebody knows the list. It is never the only signal: every item
 * keeps its label, because a picture of a shield means "biosecurity" only to
 * somebody who already knew, and this farm will put a phone in the hands of
 * people who have not used the system before.
 *
 * So each one is `aria-hidden`. A screen reader announces the label and nothing
 * else — a decorative glyph read aloud before every destination is noise, not
 * information.
 *
 * ── SPECIES-NEUTRAL, LIKE EVERYTHING ELSE IN THE CORE ──────────────────────
 *
 * `flocks` is a group of three shapes, not a hen. `production` is a basket, not
 * an egg. The words already come from the species profile; drawing a chicken
 * over them would put the poultry assumption back one layer down, where nobody
 * would think to look for it.
 *
 * Drawn on a 20-unit grid, stroked in `currentColor` so the active and resting
 * states need no second copy.
 */

export type IconName =
  | 'today'
  | 'alerts'
  | 'dashboard'
  | 'report'
  | 'flocks'
  | 'production'
  | 'health'
  | 'lighting'
  | 'biosecurity'
  | 'store'
  | 'purchases'
  | 'suppliers'
  | 'sell'
  | 'orders'
  | 'dispatch'
  | 'buyers'
  | 'enquiries'
  | 'money'
  | 'costs'
  | 'tasks'
  | 'incidents'
  | 'attendance'
  | 'people'
  | 'settings';

const PATHS: Record<IconName, React.ReactNode> = {
  // A clipboard with a tick — the sheet somebody fills in every evening.
  today: (
    <>
      <rect x="4.5" y="3.5" width="11" height="13" rx="1.5" />
      <path d="M7.5 3.5V2.5h5v1" />
      <path d="M7.5 10.5l2 2 3.5-4" />
    </>
  ),
  alerts: (
    <>
      <path d="M6 8a4 4 0 118 0c0 3 1.5 4.5 1.5 4.5h-11S6 11 6 8z" />
      <path d="M8.5 15a1.5 1.5 0 003 0" />
    </>
  ),
  // Tiles, because that is what the screen is.
  dashboard: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="11" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="11" width="6" height="6" rx="1" />
      <rect x="11" y="11" width="6" height="6" rx="1" />
    </>
  ),
  // Bars, not a page of text — the report is figures over a period.
  report: (
    <>
      <path d="M3 17h14" />
      <path d="M6 17V9" />
      <path d="M10 17V4" />
      <path d="M14 17v-5" />
    </>
  ),
  // A GROUP, not an animal. Three of something, together.
  flocks: (
    <>
      <circle cx="6.5" cy="7" r="2.5" />
      <circle cx="13.5" cy="7" r="2.5" />
      <circle cx="10" cy="13" r="2.5" />
    </>
  ),
  // A basket of what was gathered. Not an egg — see the note at the top.
  production: (
    <>
      <path d="M3 8h14l-1.5 8h-11L3 8z" />
      <path d="M7 8l2-4M13 8l-2-4" />
    </>
  ),
  health: (
    <>
      <rect x="3" y="6" width="14" height="10" rx="2" />
      <path d="M7.5 6V4.5h5V6" />
      <path d="M10 9v4M8 11h4" />
    </>
  ),
  lighting: (
    <>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M10 2v1.5M10 13.5V15M3.5 8.5H5M15 8.5h1.5M5.4 3.9l1 1M13.6 3.9l-1 1" />
      <path d="M8.5 17h3" />
    </>
  ),
  biosecurity: (
    <>
      <path d="M10 2.5l6 2.5v5c0 4-3 6.5-6 7.5-3-1-6-3.5-6-7.5V5l6-2.5z" />
      <path d="M7.5 10l2 2 3-3.5" />
    </>
  ),
  store: (
    <>
      <path d="M3 7l7-3.5L17 7v8a1 1 0 01-1 1H4a1 1 0 01-1-1V7z" />
      <path d="M7.5 16v-5h5v5" />
    </>
  ),
  purchases: (
    <>
      <path d="M3 4h2l2 8.5h8" />
      <path d="M6.5 7H17l-1.5 5.5" />
      <circle cx="8" cy="16" r="1.2" />
      <circle cx="14" cy="16" r="1.2" />
    </>
  ),
  suppliers: (
    <>
      <path d="M3 17V7l5-3v4l5-3v12" />
      <path d="M13 9h4v8" />
      <path d="M3 17h14" />
    </>
  ),
  // A price tag: the counter sale, where a figure is read out and taken.
  sell: (
    <>
      <path d="M3 9.5V4a1 1 0 011-1h5.5l7 7-6.5 6.5-7-7z" />
      <circle cx="6.8" cy="6.8" r="1.1" />
    </>
  ),
  orders: (
    <>
      <rect x="4" y="3" width="12" height="14" rx="1.5" />
      <path d="M7 7.5h6M7 10.5h6M7 13.5h3.5" />
    </>
  ),
  dispatch: (
    <>
      <path d="M2.5 6h8v7h-8z" />
      <path d="M10.5 9H14l3 2.5V13h-6.5z" />
      <circle cx="6" cy="15" r="1.4" />
      <circle cx="14" cy="15" r="1.4" />
    </>
  ),
  buyers: (
    <>
      <circle cx="7.5" cy="7" r="2.5" />
      <path d="M3 16c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <path d="M13 6.2a2.4 2.4 0 010 4.6M14.5 15.8c0-2 .9-3.1 2.5-3.6" />
    </>
  ),
  enquiries: (
    <>
      <rect x="3" y="4.5" width="14" height="11" rx="1.5" />
      <path d="M3.5 5.5l6.5 5 6.5-5" />
    </>
  ),
  // Money arriving.
  money: (
    <>
      <rect x="2.5" y="6" width="15" height="9" rx="1.5" />
      <circle cx="10" cy="10.5" r="2.2" />
      <path d="M5.5 10.5h.01M14.5 10.5h.01" />
    </>
  ),
  // A receipt — what the farm spent, itemised.
  costs: (
    <>
      <path d="M5 2.5h10v15l-2-1.3-1.7 1.3-1.8-1.3L7.7 17 6 15.7 5 17V2.5z" />
      <path d="M8 6.5h4M8 9.5h4M8 12.5h2.5" />
    </>
  ),
  tasks: (
    <>
      <path d="M3.5 5.5l2 2 3-3.5" />
      <path d="M3.5 13.5l2 2 3-3.5" />
      <path d="M11 6h6M11 14h6" />
    </>
  ),
  incidents: (
    <>
      <path d="M10 3l7.5 13H2.5L10 3z" />
      <path d="M10 8v3.5M10 13.6h.01" />
    </>
  ),
  attendance: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4.3l2.8 1.7" />
    </>
  ),
  // A badge, so the farm's own staff are not the same glyph as its buyers.
  people: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <circle cx="8" cy="9" r="1.8" />
      <path d="M5.2 14c.3-1.6 1.4-2.4 2.8-2.4s2.5.8 2.8 2.4" />
      <path d="M13 8.5h2.5M13 11.5h2.5" />
    </>
  ),
  /**
   * Sliders, not a cog.
   *
   * A cog at twenty pixels is a small circle with spokes, which is also what
   * `lighting` is — a sun. Side by side in the same column they read as the same
   * picture, which is worse than having no picture at all: it makes the eye
   * stop on the wrong row. Sliders share nothing with any other glyph here.
   */
  settings: (
    <>
      <path d="M3 6h5M12 6h5M3 14h9M16 14h1" />
      <circle cx="10" cy="6" r="2" />
      <circle cx="14" cy="14" r="2" />
    </>
  ),
};

export function NavIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
