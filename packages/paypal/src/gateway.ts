import type { PaymentGateway } from "@slip/domain";
import { createPayPalApi, type PayPalApiOptions } from "./client.js";
import { createOrderOperations } from "./orders.js";
import { createOrderLookup } from "./search.js";
import { createVaultOperations, type VaultOptions } from "./vault.js";
import { createWebhookOperations, type WebhookOptions } from "./webhooks.js";

/**
 * The whole PayPal gateway: the money, the vault, the webhooks and the records, over one client
 * and one access token.
 *
 * The parts are assembled rather than written together because they answer to different things —
 * an order is idempotent and may end `unknown`; a vault setup either happened or did not; a
 * webhook is verified before it is read; a lookup is a read of PayPal's reporting. Keeping them
 * apart is also what lets the lookup read an order through the same mapping the resolver sees.
 */

export interface PayPalGatewayOptions extends PayPalApiOptions, VaultOptions, WebhookOptions {}

export function createPayPalGateway(options: PayPalGatewayOptions): PaymentGateway {
  const api = createPayPalApi(options);
  const orders = createOrderOperations(api);
  const lookup = createOrderLookup(api, orders.getOrder);
  return {
    ...orders,
    ...lookup,
    ...createVaultOperations(api, options),
    ...createWebhookOperations(api, options),
  };
}
