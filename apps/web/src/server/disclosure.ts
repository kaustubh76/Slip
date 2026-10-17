/**
 * The line under the tabs on every page: what in this deployment is real. While Channel3 and
 * PayPal are the in-memory stand-ins, saying "PayPal sandbox" would overclaim — the stores and
 * prices are made up and no PayPal call leaves the server — so the line says exactly that. The
 * spec's sentence returns when the sandbox adapters replace the stand-ins.
 */
export function disclosure(simulated: boolean): string {
  return simulated
    ? "Simulated demo: PayPal and Channel3 are stand-ins running in this server; stores and prices are made up. Slip is the seller. No real money moves; no order reaches a retailer."
    : "Demo runs in PayPal sandbox. Slip is the seller. No real money moves; no order reaches a retailer.";
}
