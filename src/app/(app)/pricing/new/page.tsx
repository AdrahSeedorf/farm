import type { Metadata } from 'next';
import Link from 'next/link';
import { pageGuard } from '@/lib/session';
import { Forbidden } from '@/components/ui/Forbidden';
import { saleableGrades } from '@/lib/product-service';
import { ProductForm } from '../PricingForms';

export const metadata: Metadata = { title: 'Add a product' };

export default async function NewProductPage() {
  const { principal, allowed } = await pageGuard('product:create');
  if (!allowed) return <Forbidden area="products and prices" roles={principal.roles} />;

  const grades = await saleableGrades(principal);

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link href="/pricing" className="text-[14px] font-semibold text-brand-primary">
        ← Products &amp; prices
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Add a product</h1>
      <p className="mt-1 text-[15px] text-text-secondary">
        A pack the farm sells. Set what it costs once it exists.
      </p>

      <div className="mt-7">
        <ProductForm
          productId={null}
          grades={grades}
          defaults={{
            sku: '',
            name: '',
            gradeId: '',
            unitsPerPack: '30',
            packLabel: 'crate',
            notes: '',
          }}
        />
      </div>
    </main>
  );
}
