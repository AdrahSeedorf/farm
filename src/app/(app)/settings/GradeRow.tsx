'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { GradeForm } from './GradeForm';
import { updateProductionGrade, setProductionGradeActive } from './actions';
import type { FormState } from '../sites/actions';

interface Props {
  grade: {
    id: string;
    key: string;
    name: string;
    isSaleable: boolean;
    minGrams: number | null;
    maxGrams: number | null;
    isActive: boolean;
    itemId: string | null;
    /** How many collections have ever been recorded against this grade. */
    lineCount: number;
  };
  /** Store items a grade may be held as. */
  items: { id: string; name: string; sku: string }[];
  canManage: boolean;
}

/**
 * One grade in the list, with its editor folded away until it is wanted.
 *
 * COLOUR IS SPENT ONLY ON EXCEPTIONS. An ordinary saleable grade is uncoloured;
 * a retired one is dimmed and says so. A list with no colour on it is a
 * catalogue with nothing wrong in it.
 */
export function GradeRow({ grade, items, canManage }: Props) {
  const [open, setOpen] = useState(false);

  const band =
    grade.minGrams === null && grade.maxGrams === null
      ? 'No weight band set'
      : `${grade.minGrams ?? '—'}–${grade.maxGrams ?? '—'} g`;

  return (
    <li className={`py-3.5 ${grade.isActive ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold text-text-primary">{grade.name}</span>
        <span className="font-mono text-[12px] text-text-muted">{grade.key}</span>

        {grade.isSaleable ? null : (
          <span className="rounded bg-surface-sunken px-2 py-0.5 text-[12px] text-text-secondary">
            Not saleable
          </span>
        )}
        {grade.isActive ? null : (
          <span className="rounded bg-surface-sunken px-2 py-0.5 text-[12px] text-text-secondary">
            Retired
          </span>
        )}

        <span className="ml-auto text-[13px] text-text-muted">{band}</span>

        {canManage ? (
          <div className="flex w-full items-center gap-1 sm:w-auto sm:pl-3">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="min-h-[36px] rounded-control px-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
            >
              {open ? 'Close' : 'Edit'}
              <span className="sr-only"> {grade.name}</span>
            </button>
            <RetireToggle
              gradeId={grade.id}
              name={grade.name}
              isActive={grade.isActive}
              lineCount={grade.lineCount}
            />
          </div>
        ) : null}
      </div>

      {open && canManage ? (
        <div className="mt-4 rounded-card border border-border-default bg-surface-sunken p-4">
          <GradeForm
            action={updateProductionGrade.bind(null, grade.id)}
            defaults={{
              name: grade.name,
              isSaleable: grade.isSaleable,
              minGrams: grade.minGrams,
              maxGrams: grade.maxGrams,
              itemId: grade.itemId,
            }}
            items={items}
            submitLabel="Save grade"
            idPrefix={`grade-${grade.id}`}
          />
          <p className="mt-3 text-[13px] text-text-muted">
            The key <code className="font-mono text-text-secondary">{grade.key}</code> never
            changes. Renaming a grade changes what the screens say; it does not orphan the{' '}
            {grade.lineCount.toLocaleString('en-GH')} collection
            {grade.lineCount === 1 ? '' : 's'} already recorded against it.
          </p>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Retire a grade, or bring it back. Never a delete — collections point at
 * grades, and deleting one would either take those records with it or leave rows
 * nobody can name.
 */
function RetireToggle({
  gradeId,
  name,
  isActive,
  lineCount,
}: {
  gradeId: string;
  name: string;
  isActive: boolean;
  lineCount: number;
}) {
  const [state, formAction] = useActionState(
    setProductionGradeActive.bind(null, gradeId),
    {} as FormState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="intent" value={isActive ? 'retire' : 'restore'} />
      <RetireButton label={isActive ? 'Retire' : 'Restore'} name={name} count={lineCount} />
      {state.error ? (
        <p role="alert" className="mt-1.5 text-[13px] text-status-critical">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

function RetireButton({
  label,
  name,
  count,
}: {
  label: string;
  name: string;
  count: number;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={
        count > 0
          ? `${count.toLocaleString('en-GH')} collections have used this grade. Retiring keeps every one of them.`
          : undefined
      }
      className="min-h-[36px] rounded-control px-2.5 text-[13px] font-semibold text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary disabled:opacity-50"
    >
      {pending ? '…' : label}
      <span className="sr-only"> {name}</span>
    </button>
  );
}
