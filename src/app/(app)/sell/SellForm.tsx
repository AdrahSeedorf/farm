'use client';

import { useActionState, useState, useMemo } from 'react';
import { useFormStatus } from 'react-dom';
import { Field, TextInput, Select, Button } from '@/components/ui/form';
import { formatGHS, pesewas, toCedis, parseCedis } from '@/lib/money';
import { BUYER_MODES, buyerSentence, type BuyerMode } from '@/lib/counter-sale';
import { sell, type SellFormState } from './actions';

/**
 * Selling at the gate.
 *
 * ONE SCREEN, ONE BUTTON. Through the ordinary screens this is five pages, and
 * five pages with a customer waiting and a car engine running means the sale is
 * not recorded at all.
 *
 * THE RUNNING TOTAL IS THE POINT OF THE LAYOUT. Somebody is about to be handed
 * money; the figure they read out has to be on the screen before they take it,
 * in crates and in cedis, without submitting anything first.
 */

export interface SellableProductView {
  id: string;
  name: string;
  packLabel: string;
  unitsPerPack: number;
  pricePesewas: number | null;
  onHandBase: number | null;
}

const MODE_LABELS: Record<BuyerMode, string> = {
  EXISTING: 'A buyer already on the list',
  NEW: 'Somebody new — take their number',
  COUNTER: 'Cash sale, no details taken',
};

function Submit({ confirming, total }: { confirming: boolean; total: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? 'Recording…'
        : confirming
          ? 'Yes, record it as it stands'
          : `Record the sale — ${total}`}
    </Button>
  );
}

export function SellForm({
  products,
  customers,
  sites,
  flocks,
  restrictedNames,
  agreedPrices,
}: {
  products: SellableProductView[];
  customers: { id: string; name: string; businessName: string | null }[];
  sites: { id: string; name: string }[];
  flocks: { id: string; name: string }[];
  /** Houses inside a withdrawal period today. Empty is the ordinary case. */
  restrictedNames: string[];
  /**
   * Buyers with an agreed price that differs from the list, by product.
   *
   * THE PRICE ON SCREEN IS READ ALOUD BEFORE MONEY CHANGES HANDS, so it has to
   * follow the buyer the instant one is chosen. The server resolves the price
   * again when it writes — this is what to show, never what to charge.
   */
  agreedPrices: Record<string, Record<string, number>>;
}) {
  const [state, formAction] = useActionState(sell, {} as SellFormState);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [buyerMode, setBuyerMode] = useState<BuyerMode>('COUNTER');
  const [customerId, setCustomerId] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [flockId, setFlockId] = useState('');
  const [takenBy, setTakenBy] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const e = state.fieldErrors ?? {};
  const confirming = Boolean(state.warnings?.length);

  /**
   * What this product costs THIS buyer, before anybody types over it.
   *
   * ONE FUNCTION FOR THE HINT, THE PLACEHOLDER AND THE TOTAL. Three copies of
   * this rule would eventually disagree, and the way somebody would find out is
   * a customer being told one figure and charged another.
   */
  const shownPrice = (productId: string, listPrice: number | null): number | null => {
    if (buyerMode === 'EXISTING' && customerId) {
      const agreed = agreedPrices[customerId]?.[productId];
      if (agreed !== undefined) return agreed;
    }
    return listPrice;
  };

  /**
   * The total, worked out in the browser from the same rule the server uses: a
   * typed price wins, otherwise this buyer's price. It is read out to a customer,
   * so it has to be right before anything is submitted — and the server resolves
   * it again anyway, because a figure a browser calculated is not a figure a farm
   * can rely on.
   */
  const { total, packs, units } = useMemo(() => {
    let pesewasTotal = 0;
    let packCount = 0;
    let unitCount = 0;
    for (const product of products) {
      const quantity = Number(quantities[product.id] ?? '');
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const typed = prices[product.id]?.trim();
      const price = typed ? parseCedis(typed) : shownPrice(product.id, product.pricePesewas);
      if (price === null || price === undefined) continue;
      pesewasTotal += price * quantity;
      packCount += quantity;
      unitCount += quantity * product.unitsPerPack;
    }
    return { total: formatGHS(pesewas(pesewasTotal)), packs: packCount, units: unitCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, quantities, prices, buyerMode, customerId, agreedPrices]);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {state.error ? (
        <div
          role="alert"
          className="rounded-control border border-status-critical bg-status-critical-bg px-3.5 py-3"
        >
          <p className="text-[14px] font-semibold text-status-critical">{state.error}</p>
          {state.clearsOn ? (
            <p className="mt-1 text-[13px] text-status-critical">Clear from {state.clearsOn}.</p>
          ) : null}
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alert"
          className="rounded-control border border-status-attention bg-status-attention-bg px-3.5 py-3"
        >
          <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-status-attention">
            Check this before they drive off
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[14px] text-status-attention">
            {state.warnings!.map((w) => (
              <li key={`${w.field}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-status-attention">
            Nothing has been saved yet. Correct it, or record it exactly as it stands — what
            actually left is what belongs on the record.
          </p>
        </div>
      ) : null}
      <input type="hidden" name="acknowledged" value={state.warningToken ?? ''} />

      {/* WHAT THEY ARE TAKING — first, because it is what the conversation is
          about. The buyer question comes after, when the crates are counted. */}
      <section className="rounded-card border border-border-default bg-surface-card p-5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          What they are taking
        </h2>
        <ul className="mt-4 space-y-4">
          {products.map((product) => (
            <li key={product.id} className="grid grid-cols-[1fr_5rem_6rem] items-end gap-2">
              <div>
                <p className="text-[15px] font-semibold text-text-primary">{product.name}</p>
                <p className="text-[13px] text-text-muted">
                  {shownPrice(product.id, product.pricePesewas) === null
                    ? 'No price set'
                    : `${formatGHS(
                        pesewas(shownPrice(product.id, product.pricePesewas)!),
                      )} a ${product.packLabel}`}
                  {product.onHandBase === null ? '' : ` · ${product.onHandBase} in the store`}
                </p>
              </div>
              <Field
                label="How many"
                htmlFor={`qty-${product.id}`}
                error={e[`qty-${product.id}`]}
              >
                <TextInput
                  id={`qty-${product.id}`}
                  name={`qty-${product.id}`}
                  inputMode="numeric"
                  placeholder="0"
                  value={quantities[product.id] ?? ''}
                  onChange={(ev) =>
                    setQuantities((q) => ({ ...q, [product.id]: ev.target.value }))
                  }
                  error={e[`qty-${product.id}`]}
                />
              </Field>
              <Field
                label="Price each"
                htmlFor={`price-${product.id}`}
                error={e[`price-${product.id}`]}
              >
                <TextInput
                  id={`price-${product.id}`}
                  name={`price-${product.id}`}
                  inputMode="decimal"
                  placeholder={
                    shownPrice(product.id, product.pricePesewas) === null
                      ? 'needed'
                      : String(toCedis(pesewas(shownPrice(product.id, product.pricePesewas)!)))
                  }
                  value={prices[product.id] ?? ''}
                  onChange={(ev) => setPrices((p) => ({ ...p, [product.id]: ev.target.value }))}
                  error={e[`price-${product.id}`]}
                />
              </Field>
            </li>
          ))}
        </ul>

        {/* READ THIS OUT BEFORE TAKING THE MONEY. */}
        <div
          aria-live="polite"
          className="mt-5 flex flex-wrap items-baseline justify-between gap-2 border-t border-border-default pt-4"
        >
          <span className="text-[14px] text-text-secondary">
            {packs === 0 ? 'Nothing on it yet' : `${packs} packs · ${units} in all`}
          </span>
          <span className="tabular text-[26px] font-bold text-text-primary">{total}</span>
        </div>
      </section>

      <section className="rounded-card border border-border-default bg-surface-card p-5">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-accent">
          Who is buying
        </h2>

        <div className="mt-4 space-y-4">
          <Field label="" htmlFor="buyerMode" error={e.buyerMode}>
            <Select
              id="buyerMode"
              name="buyerMode"
              value={buyerMode}
              onChange={(ev) => setBuyerMode(ev.target.value as BuyerMode)}
            >
              {BUYER_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </Select>
          </Field>

          {buyerMode === 'EXISTING' ? (
            <Field label="Which buyer" htmlFor="customerId" required error={e.customerId}>
              <Select
                id="customerId"
                name="customerId"
                value={customerId}
                onChange={(ev) => setCustomerId(ev.target.value)}
                error={e.customerId}
              >
                <option value="">Choose a buyer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.businessName ? `${c.businessName} · ${c.name}` : c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {buyerMode === 'NEW' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="buyerName" required error={e.buyerName}>
                <TextInput
                  id="buyerName"
                  name="buyerName"
                  value={buyerName}
                  onChange={(ev) => setBuyerName(ev.target.value)}
                  error={e.buyerName}
                />
              </Field>
              <Field label="Phone" htmlFor="buyerPhone" required error={e.buyerPhone}>
                <TextInput
                  id="buyerPhone"
                  name="buyerPhone"
                  inputMode="tel"
                  placeholder="024 123 4567"
                  value={buyerPhone}
                  onChange={(ev) => setBuyerPhone(ev.target.value)}
                  error={e.buyerPhone}
                />
              </Field>
            </div>
          ) : null}

          {buyerSentence({ mode: buyerMode }) ? (
            <p className="text-[13.5px] text-text-secondary">
              {buyerSentence({ mode: buyerMode })}
            </p>
          ) : null}
        </div>
      </section>

      {/* THE HOUSE QUESTION, ONLY WHEN IT MATTERS. Asking which house every gate
          sale came from would be a question nobody can answer about pooled eggs,
          asked hundreds of times to catch the one week it counts. */}
      {restrictedNames.length > 0 ? (
        <section
          role="alert"
          className="rounded-card border border-status-critical bg-status-critical-bg p-5"
        >
          <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-status-critical">
            Withdrawal period in force
          </h2>
          <p className="mt-2 text-[15px] font-medium text-status-critical">
            {restrictedNames.join(', ')} {restrictedNames.length === 1 ? 'is' : 'are'} inside a
            withdrawal period, so nothing can be sold until somebody says which house it comes
            from. Eggs are pooled in the store — the software cannot tell, and will not guess.
          </p>
          <div className="mt-3">
            <Field label="Which house does this produce come from?" htmlFor="flockId">
              <Select
                id="flockId"
                name="flockId"
                value={flockId}
                onChange={(ev) => setFlockId(ev.target.value)}
              >
                <option value="">Not stated</option>
                {flocks.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {sites.length > 1 ? (
          <Field label="From which farm" htmlFor="siteId" required error={e.siteId}>
            <Select
              id="siteId"
              name="siteId"
              value={siteId}
              onChange={(ev) => setSiteId(ev.target.value)}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="siteId" value={siteId} />
        )}

        <Field
          label="Who took it"
          htmlFor="takenBy"
          error={e.takenBy}
          hint="Leave blank and the buyer’s name is used."
        >
          <TextInput
            id="takenBy"
            name="takenBy"
            value={takenBy}
            onChange={(ev) => setTakenBy(ev.target.value)}
            error={e.takenBy}
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={e.notes}>
        <TextInput
          id="notes"
          name="notes"
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
          error={e.notes}
        />
      </Field>

      <Submit confirming={confirming} total={total} />
    </form>
  );
}
