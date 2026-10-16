// USD estimate for standard US domestic-card processing. Actual Stripe fees vary.
export function priceBreakdown(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0 || amountCents > 9999999)
    throw new Error("Enter an amount from $0 to $99,999.99.");
  if (!amountCents) return { service: 0, processing: 0, total: 0 };
  let total = Math.ceil((amountCents + 30) * 1000 / 971);
  while (total - 1 - Math.floor(((total - 1) * 29 + 500) / 1000) - 30 >= amountCents) total--;
  return { service: amountCents, processing: total - amountCents, total };
}
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
