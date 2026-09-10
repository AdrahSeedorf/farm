import type { NextConfig } from 'next';

/**
 * Next configuration — ADRAH Farms
 *
 * Deliberately small. Every option here is one somebody would otherwise have to
 * discover the hard way in production.
 */
const nextConfig: NextConfig = {
  /**
   * AVIF FIRST, WEBP SECOND, and no third.
   *
   * The specification asks for AVIF/WebP on the marketing pages, and this is
   * where that becomes true rather than a note in a document: `next/image`
   * re-encodes whatever is in `public/farm/` into these formats and serves the
   * best one the browser accepts. AVIF is roughly half the size of WebP at the
   * same quality on photographs of birds and buildings, which on a Ghanaian
   * mobile connection is the difference between a page that loads and one
   * somebody backs out of.
   */
  images: {
    formats: ['image/avif', 'image/webp'],
    /**
     * The widths actually used by the site, rather than the default eight.
     *
     * Every extra width is another variant the server may be asked to encode on
     * a cold cache. The public pages render images at full width on a phone and
     * at half width in a two-column grid, so these four cover every case with
     * room for a large desktop.
     */
    deviceSizes: [400, 800, 1200, 1600],
    imageSizes: [200, 400],
    /**
     * A YEAR. These are photographs of a farm, changed perhaps twice a year, and
     * a new file gets a new name — so there is nothing to be gained by
     * revalidating them and a real cost in doing so.
     */
    minimumCacheTTL: 31_536_000,
  },

  /**
   * The `X-Powered-By: Next.js` header tells an attacker which framework's
   * advisories to read. It buys nothing in return.
   */
  poweredByHeader: false,
};

export default nextConfig;
