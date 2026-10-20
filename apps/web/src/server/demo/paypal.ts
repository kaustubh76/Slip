import "server-only";
import {
  type AuthorizationResult,
  attemptId,
  type CaptureAuthorizationInput,
  type CaptureResult,
  type Clock,
  type CompleteVaultSetupResult,
  type CreateOrderInput,
  type DeleteVaultResult,
  type FindOrderInput,
  formatUsd,
  type GatewayEvent,
  type OrderLookupResult,
  type OrderResult,
  type PaymentGateway,
  type RequestId,
  type SettlementsResult,
  type StartVaultSetupInput,
  type StartVaultSetupResult,
  type Store,
  type VoidAuthorizationInput,
  type VoidResult,
  type WebhookRequest,
} from "@slip/domain";
import type {
  CaptureBehaviour,
  FakeOrder,
  FakePaymentGateway,
  OrderBehaviour,
  VoidBehaviour,
} from "@slip/paypal/fake";

/**
 * The demo's PayPal: the in-memory fake, made safe for many visitors in one process.
 *
 * - **Outcomes are forced per visitor.** The fake keeps one queue of scripted outcomes for the
 *   whole process, so "make the next order time out" would hit whoever paid next. Here an outcome
 *   is held per mandate and handed to the fake in the same synchronous step as that mandate's own
 *   call — the fake reads its queue before its first `await` — so nobody else can take it.
 * - **Each visitor sees only their own calls.** Every money call is mapped to its mandate (an
 *   order and a capture by their invoice id, which is the attempt id; a void by its authorization)
 *   and logged under it.
 * - **Approval links point at Slip's own page** instead of a PayPal host that does not exist.
 * - **Money calls can take time**, so the states written before them (INITIATED, CAPTURING,
 *   VOIDING) are visible on the page. A deadline that passes while waiting is a timeout before
 *   PayPal received the request: nothing happens.
 */

export interface ForcedOutcomes {
  order?: OrderBehaviour;
  capture?: CaptureBehaviour;
  void?: VoidBehaviour;
}

/** One PayPal call as a demo visitor sees it in their call log. */
export interface DemoCall {
  at: string;
  call: "order" | "capture" | "void";
  attemptId: string | null;
  /** "CAPTURE $47.99", "AUTHORIZE $239.00", "capture $239.00", "void". */
  detail: string;
  /** What PayPal answered: "captured", "authorized", "declined", "unknown", …; null while waiting. */
  answer: string | null;
}

const CALLS_KEPT = 50;
const TIMED_OUT = "the simulated PayPal did not answer in time";

export class DemoPayPal implements PaymentGateway {
  readonly #inner: FakePaymentGateway;
  readonly #store: Store;
  readonly #clock: Clock;
  readonly #latencyMs: number;
  readonly #approveBase: string;
  readonly #forced = new Map<string, ForcedOutcomes>();
  readonly #calls = new Map<string, DemoCall[]>();
  readonly #mandateOfInvoice = new Map<string, string | null>();

  constructor(options: {
    inner: FakePaymentGateway;
    store: Store;
    clock: Clock;
    /** How long each order, capture or void takes; 0 answers at once. */
    latencyMs: number;
    /** Slip's public base URL; approval links point at its simulated approval page. */
    publicBaseUrl: string;
  }) {
    this.#inner = options.inner;
    this.#store = options.store;
    this.#clock = options.clock;
    this.#latencyMs = Math.max(0, options.latencyMs);
    const base = options.publicBaseUrl;
    this.#approveBase = new URL(
      "demo/paypal/approve/",
      base.endsWith("/") ? base : `${base}/`,
    ).href;
  }

  // ---------- demo controls ----------

  /**
   * Runs `work` with these outcomes forced on this mandate's next PayPal calls of each kind; any
   * left unused (the purchase never reached PayPal) are dropped when `work` ends.
   */
  async withForced<T>(
    mandateId: string,
    forced: ForcedOutcomes,
    work: () => Promise<T>,
  ): Promise<T> {
    this.#forced.set(mandateId, { ...forced });
    try {
      return await work();
    } finally {
      this.#forced.delete(mandateId);
    }
  }

  /** This mandate's PayPal calls, newest first. */
  callsFor(mandateId: string): DemoCall[] {
    return [...(this.#calls.get(mandateId) ?? [])].reverse();
  }

  /** The owner approves at (simulated) PayPal. */
  approveSetup(reference: string): void {
    this.#inner.approveSetup(reference);
  }

  /** PayPal finishes something it left pending. */
  settle(orderId: string, outcome: "completed" | "declined"): void {
    this.#inner.settle(orderId, outcome);
  }

  /**
   * PayPal finishes what it left pending for this mandate: every capture or authorization still
   * PENDING completes. Slip hears of it the way it would in production — the resolver reads the
   * order — not from here. Returns how many were settled.
   */
  async settlePending(mandateId: string): Promise<number> {
    let settled = 0;
    for (const order of this.#inner.orders()) {
      const pending =
        order.capture?.status === "PENDING" ||
        (order.capture === null && order.authorization?.status === "PENDING");
      if (pending && (await this.#mandateOf(order.invoiceId)) === mandateId) {
        this.#inner.settle(order.id, "completed");
        settled += 1;
      }
    }
    return settled;
  }

  /** The fake's orders behind one attempt. */
  ordersFor(invoiceId: string): FakeOrder[] {
    return this.#inner.ordersFor(invoiceId);
  }

  orders(): FakeOrder[] {
    return this.#inner.orders();
  }

  hasVault(vaultId: string): boolean {
    return this.#inner.hasVault(vaultId);
  }

  callsTo(method: keyof PaymentGateway) {
    return this.#inner.callsTo(method);
  }

  // ---------- PaymentGateway: money calls ----------

  async createOrder(input: CreateOrderInput, signal: AbortSignal): Promise<OrderResult> {
    const mandate = await this.#mandateOf(input.invoiceId);
    const entry = this.#log(mandate, {
      call: "order",
      attemptId: input.invoiceId,
      detail: `${input.intent} ${formatUsd(input.amountCents)}`,
    });
    if (!(await this.#wait(signal))) {
      return answered<OrderResult>(entry, { kind: "unknown", reason: TIMED_OUT });
    }
    const forced = this.#take(mandate, "order");
    if (forced !== undefined) {
      this.#inner.nextOrder(forced);
    }
    return answered(entry, await this.#inner.createOrder(input, signal));
  }

  async captureAuthorization(
    input: CaptureAuthorizationInput,
    signal: AbortSignal,
  ): Promise<CaptureResult> {
    const mandate = await this.#mandateOf(input.invoiceId);
    const entry = this.#log(mandate, {
      call: "capture",
      attemptId: input.invoiceId,
      detail: `capture ${formatUsd(input.amountCents)}`,
    });
    if (!(await this.#wait(signal))) {
      return answered<CaptureResult>(entry, { kind: "unknown", reason: TIMED_OUT });
    }
    const forced = this.#take(mandate, "capture");
    if (forced !== undefined) {
      this.#inner.nextCapture(forced);
    }
    return answered(entry, await this.#inner.captureAuthorization(input, signal));
  }

  async voidAuthorization(input: VoidAuthorizationInput, signal: AbortSignal): Promise<VoidResult> {
    const order = this.#inner.orders().find((o) => o.authorization?.id === input.authorizationId);
    const invoice = order?.invoiceId ?? null;
    const mandate = invoice === null ? null : await this.#mandateOf(invoice);
    const entry = this.#log(mandate, { call: "void", attemptId: invoice, detail: "void" });
    if (!(await this.#wait(signal))) {
      return answered<VoidResult>(entry, { kind: "unknown", reason: TIMED_OUT });
    }
    const forced = this.#take(mandate, "void");
    if (forced !== undefined) {
      this.#inner.nextVoid(forced);
    }
    return answered(entry, await this.#inner.voidAuthorization(input, signal));
  }

  // ---------- PaymentGateway: everything else, straight through ----------

  getOrder(orderId: string, signal: AbortSignal): Promise<OrderResult> {
    return this.#inner.getOrder(orderId, signal);
  }

  findOrderByInvoice(input: FindOrderInput, signal: AbortSignal): Promise<OrderLookupResult> {
    return this.#inner.findOrderByInvoice(input, signal);
  }

  listSettlements(
    window: { from: Date; to: Date },
    signal: AbortSignal,
  ): Promise<SettlementsResult> {
    return this.#inner.listSettlements(window, signal);
  }

  getAuthorization(authorizationId: string, signal: AbortSignal): Promise<AuthorizationResult> {
    return this.#inner.getAuthorization(authorizationId, signal);
  }

  async startVaultSetup(
    input: StartVaultSetupInput,
    signal: AbortSignal,
  ): Promise<StartVaultSetupResult> {
    const started = await this.#inner.startVaultSetup(input, signal);
    return started.kind === "started"
      ? { ...started, approveUrl: `${this.#approveBase}${encodeURIComponent(started.reference)}` }
      : started;
  }

  completeVaultSetup(
    input: { reference: string; requestId: RequestId },
    signal: AbortSignal,
  ): Promise<CompleteVaultSetupResult> {
    return this.#inner.completeVaultSetup(input, signal);
  }

  deleteVaultToken(vaultId: string, signal: AbortSignal): Promise<DeleteVaultResult> {
    return this.#inner.deleteVaultToken(vaultId, signal);
  }

  verifyWebhook(request: WebhookRequest, signal: AbortSignal): Promise<boolean> {
    return this.#inner.verifyWebhook(request, signal);
  }

  interpretWebhook(payload: unknown): GatewayEvent {
    return this.#inner.interpretWebhook(payload);
  }

  // ---------- internals ----------

  /** The mandate behind an attempt id; attempts never change, so the answer is kept. */
  async #mandateOf(invoiceId: string): Promise<string | null> {
    if (this.#mandateOfInvoice.has(invoiceId)) {
      return this.#mandateOfInvoice.get(invoiceId) ?? null;
    }
    let mandate: string | null = null;
    try {
      mandate = (await this.#store.attempts.get(attemptId(invoiceId)))?.attempt.mandateId ?? null;
    } catch {
      mandate = null;
    }
    this.#mandateOfInvoice.set(invoiceId, mandate);
    return mandate;
  }

  /** Takes this mandate's forced outcome for one kind of call, once. */
  #take<K extends keyof ForcedOutcomes>(
    mandate: string | null,
    kind: K,
  ): ForcedOutcomes[K] | undefined {
    if (mandate === null) {
      return undefined;
    }
    const forced = this.#forced.get(mandate);
    const outcome = forced?.[kind];
    if (forced !== undefined) {
      delete forced[kind];
    }
    return outcome;
  }

  #wait(signal: AbortSignal): Promise<boolean> {
    return this.#latencyMs === 0
      ? Promise.resolve(!signal.aborted)
      : this.#clock.sleep(this.#latencyMs, signal);
  }

  #log(mandate: string | null, call: Omit<DemoCall, "at" | "answer">): DemoCall {
    const entry: DemoCall = { at: this.#clock.now().toISOString(), answer: null, ...call };
    if (mandate !== null) {
      const calls = this.#calls.get(mandate) ?? [];
      calls.push(entry);
      if (calls.length > CALLS_KEPT) {
        calls.splice(0, calls.length - CALLS_KEPT);
      }
      this.#calls.set(mandate, calls);
    }
    return entry;
  }
}

/** Notes PayPal's answer on the call-log entry and passes the answer on. */
function answered<T extends { kind: string }>(entry: DemoCall, result: T): T {
  entry.answer = result.kind;
  return result;
}
