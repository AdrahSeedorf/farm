'use client';

import { useState } from 'react';
import { LoginForm } from './LoginForm';
import { PinLoginForm } from './PinLoginForm';

/**
 * The two ways into the system.
 *
 * PHONE AND PIN IS THE DEFAULT TAB, not email. Most people who sign in to this
 * every day are farmhands with a phone and no email address; the owner signs in
 * far less often and knows where the other tab is. Defaulting to email would
 * mean the majority of sign-ins begin with a wrong screen.
 *
 * The choice is client state rather than a route, so a mistyped PIN does not
 * bounce somebody back to a tab they did not choose. `?method=email` sets the
 * STARTING tab, so the one person who signs in the other way can bookmark it
 * and skip the tap.
 */
export function SignInPanel({ initialMethod = 'pin' }: { initialMethod?: 'pin' | 'email' }) {
  const [method, setMethod] = useState<'pin' | 'email'>(initialMethod);

  return (
    <div>
      <div
        role="tablist"
        aria-label="How to sign in"
        className="flex gap-1 rounded-control bg-surface-sunken p-1"
      >
        {(
          [
            ['pin', 'Phone & PIN'],
            ['email', 'Email'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={method === key}
            onClick={() => setMethod(key)}
            className={`min-h-[40px] flex-1 rounded-[6px] px-3 text-[14px] font-semibold transition-colors ${
              method === key
                ? 'bg-surface-card text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {method === 'pin' ? <PinLoginForm /> : <LoginForm />}
    </div>
  );
}
