import { money, priceBreakdown } from "@/lib/pricing";
export function PriceBreakdown({ amount }: { amount: number }) {
  const price = priceBreakdown(amount);
  return <div className="price-breakdown" aria-label="Price breakdown">
    <dl><div><dt>Consultation</dt><dd>{money(price.service)}</dd></div>
      {amount > 0 && <div><dt>Estimated processing cost, included</dt><dd>{money(price.processing)}</dd></div>}
      <div className="price-total"><dt>Total today</dt><dd>{amount ? money(price.total) : "Free"}</dd></div></dl>
    {amount > 0 && <p className="field-help">One payment. Processing is already included in this total, based on a US domestic-card estimate. Your consultant’s actual Stripe fees may vary.</p>}
  </div>;
}
