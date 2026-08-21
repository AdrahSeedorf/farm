import type { Metadata, Viewport } from 'next';
import { BRAND } from '@/lib/brand';
import './globals.css';

/**
 * FONTS — a deliberate decision, not an oversight.
 *
 * The brand typeface is Outfit. We do NOT load it via `next/font/google`,
 * because that makes every production build depend on reaching
 * fonts.googleapis.com at build time. On an intermittent connection — which is
 * the working assumption for this project — that turns a routine deploy into a
 * failed one for reasons that have nothing to do with the code.
 *
 * Instead the font stack degrades to Avenir Next / Helvetica Neue / Arial,
 * which is the documented fallback in the design system and looks correct.
 *
 * TO SELF-HOST OUTFIT (recommended before public launch):
 *   1. Download Outfit from https://fonts.google.com/specimen/Outfit (OFL licensed)
 *   2. Put Outfit-Variable.woff2 in src/app/fonts/
 *   3. Replace this comment with:
 *
 *        import localFont from 'next/font/local';
 *        const outfit = localFont({
 *          src: './fonts/Outfit-Variable.woff2',
 *          variable: '--font-outfit',
 *          display: 'swap',
 *        });
 *
 *      and add `className={outfit.variable}` to the <html> element below.
 *
 * The font then ships from our own origin: no third-party request, no build-time
 * network dependency, and one fewer thing between a customer and the page.
 */

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s · ${BRAND.name}`,
  },
  description: `${BRAND.name}. Fresh table eggs produced in ${BRAND.location.country}. Wholesale and retail supply, farm collection and delivery.`,
};

export const viewport: Viewport = {
  themeColor: '#14532D',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH">
      <body>{children}</body>
    </html>
  );
}
