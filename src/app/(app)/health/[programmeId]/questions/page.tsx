import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { programmeById } from '@/lib/health-service';
import {
  GENERAL_QUESTIONS,
  blankFields,
  DRAFT_SOURCE_NOTE,
} from '@/lib/draft-programme';

export const metadata: Metadata = { title: 'Questions for the vet' };

/**
 * The sheet somebody carries out of the office.
 *
 * PRINTED, NOT EMAILED. The two people who have to answer this — a chick
 * supplier and the District Veterinary Officer for Adansi South — are reached by
 * turning up, and a sheet with blanks on it is what gets filled in when you do.
 *
 * IT ASKS FOR EXACTLY WHAT THE SYSTEM NEEDS AND NOTHING ELSE. Every blank here
 * is a column the schedule cannot work without, which is why the egg withdrawal
 * line says "write 0 if none" — a zero is an answer and a blank is not, and the
 * sale gate treats them differently.
 *
 * The print rules below hide the navigation and the explanatory text, so what
 * comes out of the printer is a form rather than a web page.
 */
export default async function QuestionsPage({
  params,
}: {
  params: Promise<{ programmeId: string }>;
}) {
  const { principal, allowed } = await pageGuard('health:view');
  if (!allowed) return <Forbidden area="health records" roles={principal.roles} />;

  const { programmeId } = await params;
  const programme = await programmeById(principal, programmeId);
  if (!programme) notFound();

  const fields = blankFields();

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 print:max-w-none print:px-0 print:py-0">
      <style>{`
        @media print {
          nav, .no-print { display: none !important; }
          main { font-size: 11pt; }
          .sheet-item { break-inside: avoid; }
        }
      `}</style>

      <div className="no-print">
        <Link
          href={`/health/${programme.id}`}
          className="text-[14px] font-semibold text-brand-primary"
        >
          ← {programme.name}
        </Link>
      </div>

      <h1 className="mt-3 text-2xl font-bold text-text-primary">
        Questions for the vet and the hatchery
      </h1>
      <p className="mt-2 text-[15px] text-text-secondary">
        Print this and take it to two people: your chick supplier, who already
        vaccinated these birds and is the only one who knows what they gave, and the District
        Veterinary Officer for Adansi South.
      </p>

      <p className="no-print mt-4 rounded-control border border-status-attention bg-status-attention-bg px-4 py-3 text-[14px] text-status-attention">
        {DRAFT_SOURCE_NOTE}
      </p>

      <section className="mt-8">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          First, the questions that change everything else
        </h2>
        <ol className="mt-4 space-y-5">
          {GENERAL_QUESTIONS.map((q, i) => (
            <li key={q.question} className="sheet-item">
              <p className="text-[15px] font-semibold text-text-primary">
                {i + 1}. {q.question}
              </p>
              <p className="mt-0.5 text-[13px] text-text-muted">{q.why}</p>
              <div className="mt-2 border-b border-dashed border-border-strong pb-6" />
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Then, one of these for each thing on the schedule
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          These are the exact fields the system needs. It will not let eggs be sold from a
          treated house until the withdrawal line is filled in — and <strong>0 is an answer</strong>,
          where the label says none applies. A blank is not.
        </p>

        <ul className="mt-5 space-y-6">
          {programme.items.map((item) => (
            <li
              key={item.id}
              className="sheet-item rounded-card border border-border-default p-5"
            >
              <p className="text-[16px] font-bold text-text-primary">{item.name}</p>
              <p className="text-[13px] text-text-muted">
                Currently on the draft as day {item.ageDays} — confirm or correct.
              </p>
              {item.notes ? (
                <p className="no-print mt-1 text-[13px] text-text-secondary">{item.notes}</p>
              ) : null}

              <dl className="mt-4 space-y-3">
                {fields.map((field) => (
                  <div key={field} className="flex items-end gap-3">
                    <dt className="w-[46%] shrink-0 text-[13.5px] text-text-secondary">
                      {field}
                    </dt>
                    <dd className="flex-1 border-b border-dashed border-border-strong pb-4" />
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        {programme.items.length === 0 ? (
          <p className="mt-4 text-[14px] text-text-secondary">
            This programme has nothing on it yet.
          </p>
        ) : null}
      </section>

      <section className="mt-10 border-t border-border-default pt-6">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Signed off by
        </h2>
        <p className="mt-2 text-[14px] text-text-secondary">
          The system records a named person and their role against an approved schedule, so that
          months later it is clear whose judgement it was.
        </p>
        <dl className="mt-4 space-y-3">
          {['Name', 'Role', 'Date', 'Signature'].map((field) => (
            <div key={field} className="flex items-end gap-3">
              <dt className="w-[46%] shrink-0 text-[13.5px] text-text-secondary">{field}</dt>
              <dd className="flex-1 border-b border-dashed border-border-strong pb-4" />
            </div>
          ))}
        </dl>
      </section>

      <p className="no-print mt-8 text-[13px] text-text-muted">
        Use your browser’s print command. The navigation and the notes in grey are left off the
        printed sheet.
      </p>
    </main>
  );
}
