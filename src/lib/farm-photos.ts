/**
 * Photographs of the farm — ADRAH Farms
 *
 * WHY THERE IS NO UPLOAD SCREEN, AND WHY THAT IS THE RIGHT ANSWER FOR NOW.
 *
 *   The obvious build is an admin page that uploads images to object storage.
 *   That needs a provider, a bucket, credentials in production, a signing
 *   strategy, a bill, and a decision about what happens when somebody uploads a
 *   40 MB photo from a phone. None of that has been settled, and none of it earns
 *   its keep for what this actually is: about a dozen pictures of a farm, changed
 *   perhaps twice a year.
 *
 *   So the pictures live in `public/farm/` and are listed below. They are served
 *   from the same origin as the page, cached forever by the CDN, cost nothing,
 *   and cannot break in production because they are part of the build. When the
 *   farm has enough photographs that editing this list is annoying, that is the
 *   moment to add storage — and by then the file-storage question will have been
 *   answered for the task-evidence feature too, and one decision will serve both.
 *
 * NOTHING HERE IS A STOCK IMAGE, EVER.
 *   A stock photograph of somebody else's hens is the first thing a buyer who
 *   knows poultry spots, and it makes every other claim on the site suspect. A
 *   farm with no pictures of itself yet is a new farm, which is true. A farm with
 *   pictures of a Dutch layer barn is lying. Where the list below is empty the
 *   pages lay out without images rather than filling the space.
 *
 * HOW TO ADD ONE
 *   1. Put the file in `public/farm/` — a .webp or .avif under about 250 KB.
 *      Resize to 1600px on the long edge first; a phone photo is 4000px and
 *      nobody on mobile data needs that.
 *   2. Add an entry below with a real description of what is in the picture.
 *   3. Deploy.
 */

export interface FarmPhoto {
  /** File name inside `public/farm/`. */
  file: string;
  /**
   * What is actually in the picture, for somebody who cannot see it.
   *
   * NOT A CAPTION AND NOT A SLOGAN. "House A on the morning the chicks arrived"
   * describes the photograph; "quality you can trust" describes nothing and is
   * read aloud, word for word, to somebody using a screen reader.
   */
  alt: string;
  /** Where it belongs. A photo may serve more than one page. */
  places: readonly PhotoPlace[];
  /** Rendered under the image where the page shows captions. */
  caption?: string;
}

export type PhotoPlace = 'hero' | 'about' | 'quality' | 'products';

/**
 * The farm's photographs.
 *
 * DELIBERATELY EMPTY. ADRAH Farms has not been built yet, so there is nothing to
 * photograph, and every page below is written to look finished without pictures
 * rather than to look broken until it has them.
 */
export const FARM_PHOTOS: readonly FarmPhoto[] = [];

export function photosFor(place: PhotoPlace): FarmPhoto[] {
  return FARM_PHOTOS.filter((p) => p.places.includes(place));
}

export function heroPhoto(): FarmPhoto | null {
  return photosFor('hero')[0] ?? null;
}

export function hasPhotos(): boolean {
  return FARM_PHOTOS.length > 0;
}

/** The public path a photo is served from. */
export function photoSrc(photo: FarmPhoto): string {
  return `/farm/${photo.file}`;
}
