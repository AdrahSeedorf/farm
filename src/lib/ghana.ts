/**
 * Ghana reference data — ADRAH Farms
 *
 * The 16 administrative regions, following the 2019 reorganisation that split
 * the former Brong-Ahafo, Northern, Volta and Western regions.
 *
 * A free-text region field would produce "Ashanti", "ashanti", "Ashanti Region"
 * and "A/R" within a month, and every report grouped by region would be wrong.
 */

export const GHANA_REGIONS = [
  'Ahafo',
  'Ashanti',
  'Bono',
  'Bono East',
  'Central',
  'Eastern',
  'Greater Accra',
  'North East',
  'Northern',
  'Oti',
  'Savannah',
  'Upper East',
  'Upper West',
  'Volta',
  'Western',
  'Western North',
] as const;

export type GhanaRegion = (typeof GHANA_REGIONS)[number];

export function isGhanaRegion(value: string): value is GhanaRegion {
  return (GHANA_REGIONS as readonly string[]).includes(value);
}
