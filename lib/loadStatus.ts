import type { LoadStatus } from "@prisma/client";
import { HttpError } from "@/lib/errors";

/**
 * The legal moves for a load's status.
 *
 * Previously the PATCH schema only constrained `status` to the enum, so any
 * client could move a load from `pending` straight to `paid`, or drag a `paid`
 * load back to `pending`. The trips UI happened to offer only the forward chain,
 * but the API is the boundary and it enforced nothing — and the load's status is
 * what the "collected" and "booked rate value" aggregates are computed from, so
 * a rewound status corrupts revenue reporting with no error anywhere.
 *
 * Two deliberate choices:
 *  - The dispatch statuses (`pending` <-> `in_transit` <-> `delivered`) allow a
 *    one-step correction backwards, because fat-fingering "Mark in transit" is
 *    routine and being stuck would be worse than the risk.
 *  - `paid` is terminal. Reversing a payment is a billing operation against the
 *    invoices table, not a status edit, and leaving that door open is the case
 *    most likely to quietly disagree with the money.
 */
export const ALLOWED_TRANSITIONS: Record<LoadStatus, LoadStatus[]> = {
  pending: ["in_transit"],
  in_transit: ["delivered", "pending"],
  delivered: ["invoiced", "in_transit"],
  invoiced: ["paid", "overdue"],
  overdue: ["paid", "invoiced"],
  paid: [],
};

const ALL: LoadStatus[] = [
  "pending",
  "in_transit",
  "delivered",
  "invoiced",
  "paid",
  "overdue",
];

/** True when `from` -> `to` is a legal move. Staying put counts as legal. */
export function canTransition(from: LoadStatus, to: LoadStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Throws 409 unless the move is legal. Re-sending the current status is a
 * no-op rather than an error: the UI can double-submit, and rejecting that
 * would surface a spurious failure to the operator.
 */
export function assertTransition(from: LoadStatus, to: LoadStatus): void {
  if (canTransition(from, to)) return;
  throw new HttpError(
    409,
    `Cannot move a load from "${from}" to "${to}"`,
    "invalid_transition",
  );
}

/** The statuses reachable from `from`, for a UI to render as buttons. */
export function nextStatuses(from: LoadStatus): LoadStatus[] {
  return ALL.filter((s) => ALLOWED_TRANSITIONS[from].includes(s));
}
