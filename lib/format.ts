/**
 * Display formatters, in a plain .ts module so that non-React code (verification
 * scripts, services, anything in lib/) can use them without pulling in a .tsx.
 *
 * `components/ui/dashboard.tsx` re-exports both, so page imports are unchanged.
 *
 * There used to be a second, near-identical pair in `lib/utils.ts`
 * (`formatCurrency`/`formatDate`) with different rounding and a hardcoded USD.
 * Both were dead, and two money formatters with different behaviour is exactly
 * the kind of duplicate that makes a total look wrong on one page and right on
 * another. This is the only one now.
 */

const dateFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

export const formatDate = (v: Date | string | null | undefined) =>
  v ? dateFmt.format(new Date(v)) : "—";

/** A currency code Intl will accept: exactly three ASCII letters. */
const currencyCode = /^[A-Za-z]{3}$/;

const moneyFmt = new Map<string, Intl.NumberFormat>();

const plainFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format an amount for display.
 *
 * `currency` is free text on the shipping models (`ShippingInvoice.currency` is
 * a `String @default("USD")`, not an enum), so it is not guaranteed to be a code
 * Intl accepts. Passing "US" or "dollars" to `style: "currency"` throws
 * `RangeError: Invalid currency code`, and because these run inside Server
 * Component render that was a 500 on the whole page rather than one wrong-looking
 * cell.
 *
 * So an unusable code degrades to a plain number carrying the raw code, which is
 * visibly wrong and therefore reviewable, instead of taking the page down. A
 * non-numeric or non-finite amount is treated as absent for the same reason.
 */
export const formatMoney = (
  v: number | string | null | undefined,
  currency = "USD",
): string => {
  if (typeof v !== "number" && typeof v !== "string") return "—";
  const amount = Number(v);
  if (!Number.isFinite(amount)) return "—";

  const code = currency.trim();
  if (!currencyCode.test(code)) {
    return `${plainFmt.format(amount)}${code ? ` ${code}` : ""}`;
  }

  const upper = code.toUpperCase();
  let fmt = moneyFmt.get(upper);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: upper });
    } catch {
      // Well-formed but unassigned, e.g. "ZZZ".
      return `${plainFmt.format(amount)} ${upper}`;
    }
    moneyFmt.set(upper, fmt);
  }
  return fmt.format(amount);
};
