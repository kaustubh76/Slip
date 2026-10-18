import type {
  CompleteVaultSetupResult,
  DeleteVaultResult,
  PaymentGateway,
  RequestId,
  StartVaultSetupInput,
  StartVaultSetupResult,
} from "@slip/domain";
import { type PayPalApi, said } from "./client.js";
import { approveUrl, text } from "./map.js";

/**
 * Vaulting the owner's PayPal wallet, which is what a permission is made of: Slip never holds a
 * card, only a token PayPal will honour for a merchant-initiated charge.
 *
 * Two steps, because the owner has to approve in between. A setup token is created and the owner
 * is sent to PayPal with it (`approve`); once they are back, that token is exchanged for a payment
 * token — the vault id Slip charges later. The `usage_pattern` asked for here is the same one the
 * charge sends (`UNSCHEDULED_POSTPAID`): the owner approves the kind of charge Slip will actually
 * make, not a friendlier one.
 */

export type VaultOperations = Pick<
  PaymentGateway,
  "startVaultSetup" | "completeVaultSetup" | "deleteVaultToken"
>;

export interface VaultOptions {
  /** Shown on PayPal's approval page. */
  brandName?: string;
}

export function createVaultOperations(api: PayPalApi, options: VaultOptions = {}): VaultOperations {
  return {
    async startVaultSetup(input: StartVaultSetupInput, signal): Promise<StartVaultSetupResult> {
      const answer = await api.call(
        {
          path: "/v3/vault/setup-tokens",
          method: "POST",
          requestId: input.requestId,
          body: {
            payment_source: {
              paypal: {
                usage_type: "MERCHANT",
                customer_type: "CONSUMER",
                usage_pattern: "UNSCHEDULED_POSTPAID",
                experience_context: {
                  return_url: input.returnUrl,
                  cancel_url: input.cancelUrl,
                  ...(options.brandName === undefined ? {} : { brand_name: options.brandName }),
                },
              },
            },
          },
        },
        signal,
      );
      if (answer.outcome !== "ok") {
        // Nothing to resolve later: no token, no approval, so the owner simply tries again.
        return { kind: "failed", reason: detailOf(answer) };
      }
      const body = answer.body as { id?: unknown; links?: unknown } | null;
      const reference = text(body?.id);
      const approve = approveUrl(body?.links);
      if (reference === null || approve === null) {
        return {
          kind: "failed",
          reason: "PayPal's setup token carried no id or no approval link",
        };
      }
      return { kind: "started", reference, approveUrl: approve };
    },

    async completeVaultSetup(
      input: { reference: string; requestId: RequestId },
      signal,
    ): Promise<CompleteVaultSetupResult> {
      const answer = await api.call(
        {
          path: "/v3/vault/payment-tokens",
          method: "POST",
          requestId: input.requestId,
          body: { payment_source: { token: { id: input.reference, type: "SETUP_TOKEN" } } },
        },
        signal,
      );
      if (answer.outcome === "error") {
        if (said(answer, "PAYER_ACTION_REQUIRED", "SETUP_TOKEN_NOT_TOKENIZED")) {
          // The owner has not finished at PayPal. Not a failure: they can still come back.
          return { kind: "not-approved" };
        }
        return { kind: "failed", reason: answer.detail };
      }
      if (answer.outcome === "no-answer") {
        return { kind: "failed", reason: answer.detail };
      }
      const body = answer.body as { id?: unknown; customer?: { id?: unknown } } | null;
      const vaultId = text(body?.id);
      const customerId = text(body?.customer?.id);
      // Approved, but PayPal has not named the token yet: it arrives by webhook.
      return vaultId === null
        ? { kind: "pending", customerId }
        : { kind: "vaulted", vaultId, customerId };
    },

    async deleteVaultToken(vaultId, signal): Promise<DeleteVaultResult> {
      const answer = await api.call(
        { path: `/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`, method: "DELETE" },
        signal,
      );
      if (answer.outcome === "ok") {
        return { kind: "deleted" };
      }
      if (
        answer.outcome === "error" &&
        (answer.status === 404 || said(answer, "RESOURCE_NOT_FOUND", "TOKEN_NOT_FOUND"))
      ) {
        // Already gone is the outcome the owner asked for: a revoke must not fail on it.
        return { kind: "already-gone" };
      }
      return { kind: "failed", reason: detailOf(answer) };
    },
  };
}

const detailOf = (answer: { outcome: string; detail?: string; status?: number }): string =>
  answer.detail ?? `PayPal answered ${answer.status ?? "nothing"}`;
