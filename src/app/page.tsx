import { redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/session';

/**
 * Root route.
 *
 * Until Milestone 14 there is no public website, so `/` is not a page — it is a
 * signpost. Signed in, you want the farm; signed out, you want the door.
 *
 * At Milestone 14 this file is replaced by the ADRAH Farms marketing homepage
 * and the redirect moves to a "Sign in" link in that page's header.
 */
export default async function RootPage() {
  const principal = await getPrincipal();
  redirect(principal ? '/dashboard' : '/login');
}
