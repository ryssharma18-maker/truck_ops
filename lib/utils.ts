import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// `formatCurrency` and `formatDate` used to live here as well. Both were dead:
// nothing imported them, and they were near-duplicates of `formatMoney` and
// `formatDate` in components/ui/dashboard.tsx with different rounding and
// currency behaviour, which is the worst kind of duplicate to leave lying
// around in a codebase that formats money. dashboard.tsx is the single
// formatter now; see lib/money.ts for summing across currencies.
