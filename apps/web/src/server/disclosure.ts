import type { Services } from "./services";

/**
 * The line under the tabs on every page: what in *this* deployment is real. It is assembled from
 * the services themselves rather than written for one state of the world, because the states are
 * mixed — real Channel3 prices with a stand-in PayPal is the likeliest of them — and a visitor who
 * reads "simulated" over real prices has been told something false either way.
 *
 * The payment sentence is the one that matters most: only `live` moves money, and only `live` is
 * allowed to leave that out.
 */
export function disclosure(services: Services): string {
  return `${prices(services.prices)} ${payment(services.payment)} Slip is the seller; no order reaches a retailer.`;
}

function prices(mode: Services["prices"]): string {
  return mode === "channel3"
    ? "Prices are real listings from Channel3."
    : "Stores and prices are stand-ins made up in this server.";
}

function payment(mode: Services["payment"]): string {
  switch (mode) {
    case "live":
      return "Payment is live PayPal: real money moves.";
    case "sandbox":
      return "Payment runs in PayPal's sandbox; no real money moves.";
    case "simulated":
      return "PayPal is a stand-in running in this server; no real money moves.";
  }
}
