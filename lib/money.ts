import { formatMoney } from "@/lib/format";

/**
 * Currency-aware summing for the shipping money.
 *
 * `ShippingInvoice.currency` is a free-text `String @default("USD")`, not an
 * enum, so a tenant's rows can legitimately be in several currencies at once.
 * `prisma.<model>.aggregate({ _sum: { amount } })` still adds them together and
 * hands back one number, which is how the dashboard ended up rendering a total
 * in "USD" that was really a pile of euros and dollars with no exchange rate
 * applied. That figure is not just ugly, it is a receivables number someone
 * would act on.
 *
 * So the rule here is: never invent a combined total across currencies. Sum
 * within a currency, and show the per-currency figures. One currency renders as
 * a single amount; several render as the largest plus a hint listing the rest.
 */

export interface CurrencyTotal {
  currency: string;
  total: number;
}

export interface CurrencyTotals {
  /** Headline for a StatCard `value` slot. "—" when there is nothing to show. */
  text: string;
  /** Secondary line: how many currencies, and what the others add up to. */
  hint: string;
  /** Largest first. Empty when there is nothing to show. */
  totals: CurrencyTotal[];
  /** Largest single total, or null when there is nothing to show. */
  primary: CurrencyTotal | null;
  /** True when more than one currency is present, i.e. `text` is not a single sum. */
  mixed: boolean;
}

const EMPTY: CurrencyTotals = { text: "—", hint: "", totals: [], primary: null, mixed: false };

/**
 * Build the per-currency totals from a Prisma `groupBy({ by: ["currency"] })`
 * result. Accepts the raw groupBy rows so callers can hand it the query output
 * without reshaping it first.
 */
export function totalsByCurrency(
  groups: { currency: string; _sum: { amount: { toNumber(): number } | null } }[],
): CurrencyTotals {
  const byCode = new Map<string, number>();

  for (const g of groups) {
    // An empty or junk code still gets its own bucket, so the money stays
    // visible and attributable rather than being folded into USD.
    const code = g.currency.trim() || "???";
    const amount = g._sum.amount ? g._sum.amount.toNumber() : 0;
    byCode.set(code, (byCode.get(code) ?? 0) + amount);
  }

  const totals: CurrencyTotal[] = [...byCode.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => b.total - a.total);

  // `noUncheckedIndexedAccess` will not narrow `totals[0]` from a length check
  // on a derived array, so destructure and test the element itself.
  const [primary, ...rest] = totals;
  if (!primary) return EMPTY;

  if (rest.length === 0) {
    return { text: formatMoney(primary.total, primary.currency), hint: "", totals, primary, mixed: false };
  }

  return {
    text: formatMoney(primary.total, primary.currency),
    hint: `${totals.length} currencies · ${rest
      .map((t) => formatMoney(t.total, t.currency))
      .join(" + ")}`,
    totals,
    primary,
    mixed: true,
  };
}

/**
 * Every currency as a formatted amount, largest first, for prose that has to
 * spell the whole breakdown out rather than summarise it.
 */
export function describeTotals(t: CurrencyTotals): string {
  return t.totals.map((x) => formatMoney(x.total, x.currency)).join(" + ");
}
