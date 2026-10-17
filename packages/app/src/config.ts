import { DEFAULT_HOLD_TTL_MS } from "@slip/domain";
import { z } from "zod";

const ms = (fallback: number) => z.number().int().positive().default(fallback);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Every timing and limit the use cases apply. Defaults follow the spec and the decision log; the
 * schema refuses a configuration that would break an invariant (a lease shorter than the calls it
 * protects).
 */
export const AppConfigSchema = z
  .object({
    /** One checkout at a time per (agent, product); must outlast Channel3 + classifier + PayPal. */
    leaseTtlMs: ms(MINUTE),
    offersTimeoutMs: ms(5_000),
    classifierTimeoutMs: ms(5_000),
    paypalTimeoutMs: ms(15_000),
    /** A PAID purchase or a same-offer rejection in this window is replayed, not repeated. */
    dedupeWindowMs: ms(10 * MINUTE),
    /** At most `maxAttemptsPerRetryWindow` agent attempts per product in this window (1 + 3 retries). */
    retryWindowMs: ms(HOUR),
    maxAttemptsPerRetryWindow: z.number().int().positive().default(4),
    holdTtlMs: ms(DEFAULT_HOLD_TTL_MS),
    /** The resolver leaves a payment alone this long after its last change (the call may still run). */
    resolverMinAgeMs: ms(2 * MINUTE),
    /**
     * An ORDER is re-sent with its request id only this soon after the decision; later it is only
     * looked up, so no charge executes long after a decision made on a 10-minute snapshot.
     */
    orderResendWindowMs: ms(30 * MINUTE),
    /** Same for a hold's CAPTURE or VOID; afterwards the authorization is read instead. */
    operationResendWindowMs: ms(30 * MINUTE),
    /** PayPal Transaction Search lags this far behind. */
    reportingLagMs: ms(3 * HOUR),
    /** An unknown order is declared FAILED only on a definite "not found" this long after it. */
    orderGiveUpMs: ms(24 * HOUR),
    /** Mandates waiting for PayPal setup longer than this are polled. */
    setupPollAfterMs: ms(5 * MINUTE),
    /** A setup the owner never approved is given up (the mandate revoked) after this long. */
    setupAbandonAfterMs: ms(72 * HOUR),
    resolverBatchSize: z.number().int().positive().max(500).default(100),
    /** Items the resolver works on at once; each may wait on a PayPal deadline. */
    resolverConcurrency: z.number().int().positive().max(64).default(8),
    /** Where PayPal sends the owner back after approving or cancelling. */
    publicBaseUrl: z.url().default("http://localhost:3000"),
    /**
     * Who serves the prices: Channel3, or the stand-in catalogue a demo runs on. Receipts say
     * which, so a demo never presents made-up stores as Channel3 listings.
     */
    pricesSource: z.enum(["channel3", "simulated"]).default("channel3"),
  })
  .refine((c) => c.leaseTtlMs > c.offersTimeoutMs + c.classifierTimeoutMs + c.paypalTimeoutMs, {
    message: "leaseTtlMs must outlast the Channel3, classifier and PayPal deadlines together",
  })
  .refine((c) => c.setupAbandonAfterMs > c.setupPollAfterMs, {
    message: "setupAbandonAfterMs must be longer than setupPollAfterMs",
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type AppConfigInput = z.input<typeof AppConfigSchema>;

export function appConfig(overrides: AppConfigInput = {}): AppConfig {
  return AppConfigSchema.parse(overrides);
}
