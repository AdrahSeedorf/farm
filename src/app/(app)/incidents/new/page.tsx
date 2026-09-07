import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { incidentSites } from '@/lib/incident-service';
import { ReportForm } from '../IncidentForms';

export const metadata: Metadata = { title: 'Report something' };

export default async function NewIncidentPage() {
  const { principal, allowed } = await pageGuard('incident:create');
  if (!allowed) return <Forbidden area="incidents" roles={principal.roles} />;

  const sites = await incidentSites(principal);
  const now = new Date().toISOString().slice(0, 16);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/incidents" className="text-[14px] font-semibold text-brand-primary">
        ← Incidents
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Report something</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        Say what happened in your own words. Nobody is asking you to decide how serious it
        is — that is somebody else’s job, afterwards.
      </p>

      <div className="mt-7 rounded-card border border-border-default bg-surface-card p-6">
        <ReportForm sites={sites} now={now} />
      </div>
    </main>
  );
}
