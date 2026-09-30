import { HttpError } from "../lib/errors";
import { bookingDetailOrNull } from "../lib/services/shippingService";

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean): void {
  checks++;
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}`);
  }
}

async function main(): Promise<void> {
  console.log("Booking detail error handling");

  const missing = await bookingDetailOrNull(async () => {
    throw new HttpError(404, "Booking not found", "not_found");
  });
  check("missing booking becomes not-found result", missing === null);

  const databaseFailure = new HttpError(503, "Database unavailable", "database_unavailable");
  const originalConsoleError = console.error;
  let logged = false;
  console.error = (...args: unknown[]) => {
    logged = args[0] === "[shipping-booking] failed to load booking detail";
  };
  let propagated: unknown;
  try {
    await bookingDetailOrNull(async () => {
      throw databaseFailure;
    });
  } catch (error) {
    propagated = error;
  } finally {
    console.error = originalConsoleError;
  }
  check("database failure is not converted to not found", propagated === databaseFailure);
  check("infrastructure failure is logged server-side", logged);

  const unexpected = new Error("provider unavailable");
  console.error = () => undefined;
  let unexpectedPropagated: unknown;
  try {
    await bookingDetailOrNull(async () => {
      throw unexpected;
    });
  } catch (error) {
    unexpectedPropagated = error;
  } finally {
    console.error = originalConsoleError;
  }
  check("unexpected provider failure propagates to the error boundary", unexpectedPropagated === unexpected);

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Booking verification failed:", error);
  process.exitCode = 1;
});
