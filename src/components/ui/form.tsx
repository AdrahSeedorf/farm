import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from 'react';

/**
 * Form primitives — ADRAH Farms
 *
 * Small, deliberately unclever. Two rules baked in rather than left to whoever
 * writes the next form:
 *
 *   1. `min-h-touch` (48px) on every control. Farm data gets entered one-handed,
 *      in a poultry house, sometimes wearing gloves.
 *   2. 16px font size on inputs. Anything smaller makes iOS Safari zoom the page
 *      on focus, which throws the user out of the form they were filling in.
 */

const controlClass =
  'min-h-touch w-full rounded-control border border-border-strong bg-surface-card px-3 text-[16px] text-text-primary outline-none transition-colors focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/25 disabled:bg-surface-sunken disabled:text-text-muted';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-text-primary">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-status-critical">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-[12px] font-normal text-text-muted">optional</span>
        )}
      </label>
      {hint ? <p className="mt-0.5 text-[13px] text-text-muted">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-[13px] text-status-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  return (
    <input
      {...props}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${props.id}-error` : undefined}
      className={controlClass}
    />
  );
}

/**
 * A dropdown that survives a server action.
 *
 * THE BUG THIS EXISTS TO PREVENT — React 19 resets a form's DOM after a server
 * action returns. Text inputs are restored from their controlled value, but a
 * `<select>` is not: the element snaps back to its first option while the React
 * state still holds what the person chose. Everything looks fine, because the
 * state is right and only the DOM is wrong. Then the form is submitted again —
 * which is exactly what a warn-and-confirm flow asks people to do — and the
 * browser sends the FIRST OPTION instead of the choice. A feed cost confirmed
 * on screen gets recorded as a chick cost.
 *
 * So a controlled Select does not carry its own name. The visible dropdown is
 * for the person; a hidden input carrying the React value is what is submitted,
 * and React does restore that. An uncontrolled Select (no `value` prop) keeps
 * the name on the element itself, since there is no state for the DOM to
 * disagree with.
 */
export function Select({
  error,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { error?: string }) {
  const controlled = props.value !== undefined;
  const { name, ...rest } = props;

  return (
    <>
      <select
        {...rest}
        name={controlled ? undefined : name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${props.id}-error` : undefined}
        className={controlClass}
      >
        {children}
      </select>
      {controlled && name ? (
        <input type="hidden" name={name} value={String(props.value ?? '')} />
      ) : null}
    </>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-control border border-status-critical bg-status-critical-bg px-3 py-2.5 text-sm font-medium text-status-critical"
    >
      {message}
    </p>
  );
}

export function Button({
  variant = 'primary',
  children,
  ...props
}: InputHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
  type?: 'button' | 'submit';
}) {
  const styles = {
    primary: 'bg-brand-primary text-text-inverse hover:bg-brand-primary-hover',
    secondary:
      'border border-border-strong bg-surface-card text-text-primary hover:bg-surface-sunken',
    danger: 'border border-status-critical bg-surface-card text-status-critical hover:bg-status-critical-bg',
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex min-h-touch items-center justify-center rounded-control px-5 text-[15px] font-semibold transition-colors disabled:opacity-60 ${styles}`}
    >
      {children}
    </button>
  );
}
