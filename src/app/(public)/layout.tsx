import Link from 'next/link';
import { BRAND } from '@/lib/brand';
import { locationLine, publicContact } from '@/lib/public-site';

/**
 * The public site's shell.
 *
 * NOT ONE LINE OF CLIENT JAVASCRIPT, anywhere under this layout. The performance
 * budget in the specification is 150 KB of JS on marketing pages over a 3G
 * connection, and the honest way to meet a budget like that is not to spend
 * carefully — it is not to open the account. There is no `'use client'` in this
 * subtree: the navigation is links, the forms are HTML forms posting to server
 * actions, and a customer on a bad connection in New Edubiase gets the page as
 * markup that renders before anything else has to arrive.
 *
 * That constraint shapes the design rather than fighting it. No carousel, no
 * lightbox, no scroll animation, no cookie banner — all of which cost more than
 * they return on a page whose job is to make a farm look real and give somebody
 * a way to reach it.
 */

const NAV = [
  { href: '/products', label: 'Products' },
  { href: '/wholesale', label: 'Wholesale' },
  { href: '/quality', label: 'Quality' },
  { href: '/contact', label: 'Contact' },
];

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const contact = publicContact();
  const where = locationLine();

  return (
    <div className="flex min-h-screen flex-col bg-surface-page">
      <header className="border-b border-border-default bg-surface-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-[19px] font-bold tracking-tight text-brand-primary">
              {BRAND.name}
            </span>
            <span className="hidden text-[13px] text-text-muted sm:inline">
              {BRAND.descriptor}
            </span>
          </Link>

          <nav aria-label="Main" className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-control px-2.5 py-2 text-[14px] font-semibold text-text-secondary hover:text-brand-primary"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="mt-16 border-t border-border-default bg-surface-card">
        <div className="mx-auto max-w-5xl px-5 py-10">
          <div className="grid gap-8 sm:grid-cols-3">
            <div>
              <p className="text-[16px] font-bold text-brand-primary">{BRAND.name}</p>
              {where ? (
                <p className="mt-1.5 text-[14px] text-text-secondary">{where}</p>
              ) : null}
            </div>

            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                Pages
              </h2>
              <ul className="mt-2.5 space-y-1.5">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-[14px] text-text-secondary hover:text-brand-primary"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                Reach us
              </h2>
              {/* A NUMBER IS PRINTED ONLY IF IT IS REAL. See public-site.ts —
                  a business card with the wrong number on it does not read as
                  a mistake, it reads as a business that is not real. */}
              <ul className="mt-2.5 space-y-1.5 text-[14px] text-text-secondary">
                {contact.canEmail ? (
                  <li>
                    <a
                      href={`mailto:${BRAND.contact.email}`}
                      className="hover:text-brand-primary"
                    >
                      {BRAND.contact.email}
                    </a>
                  </li>
                ) : null}
                <li>
                  <Link href="/contact" className="hover:text-brand-primary">
                    Send an enquiry
                  </Link>
                </li>
                <li>
                  <Link href="/login" className="text-text-muted hover:text-brand-primary">
                    Staff sign in
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          <p className="mt-9 border-t border-border-default pt-5 text-[12.5px] text-text-muted">
            © {new Date().getFullYear()} {BRAND.legalName}. {BRAND.location.country}.
          </p>
        </div>
      </footer>
    </div>
  );
}
