import { randomBytes } from "node:crypto";
import type {
  AuthorizationResult,
  AuthorizationStatus,
  CaptureAuthorizationInput,
  CaptureResult,
  Cents,
  Clock,
  CompleteVaultSetupResult,
  CreateOrderInput,
  DeleteVaultResult,
  FindOrderInput,
  GatewayEvent,
  OrderLookupResult,
  OrderResult,
  PaymentGateway,
  PaymentIntent,
  RequestId,
  SettlementRecord,
  SettlementsResult,
  StartVaultSetupInput,
  StartVaultSetupResult,
  VoidAuthorizationInput,
  VoidResult,
  WebhookRequest,
} from "@slip/domain";

/**
 * An in-memory PayPal for the application's tests and for running Slip without credentials. It
 * keeps orders, authorizations, captures and vaulted methods, and models the behaviour Slip's
 * money handling depends on:
 *
 * - a PayPal-Request-Id seen in the last 6 hours (on the injected clock) returns the current state
 *   of what it created — never a second order — and is forgotten after that;
 * - an invoice id already used by an order is refused (`duplicate-invoice`), as PayPal does when
 *   duplicate invoice ids are blocked;
 * - a deleted vault token cannot be charged;
 * - Transaction Search lags 3 hours behind real time.
 *
 * Outcomes for the next call of each kind can be scripted, including timeouts that happen after
 * PayPal committed (the caller sees `unknown`, the order exists) or before (nothing happened).
 * A timeout hangs until the caller's deadline aborts the call. Every call is logged.
 */

export const REQUEST_ID_RETENTION_MS = 6 * 60 * 60 * 1000;
export const REPORTING_LAG_MS = 3 * 60 * 60 * 1000;

export type OrderBehaviour =
  | "ok"
  | "decline"
  | "pending"
  | "payer-action-required"
  | "duplicate-invoice"
  | "timeout-after-commit"
  | "timeout-before-commit"
  | "server-error";
export type CaptureBehaviour =
  | "ok"
  | "decline"
  | "pending"
  | "timeout-after-commit"
  | "timeout-before-commit";
export type VoidBehaviour = "ok" | "timeout-after-commit" | "timeout-before-commit";
export type LookupBehaviour = "ok" | "unknown";
export type DeleteBehaviour = "ok" | "fail";

export interface FakeCall {
  method: keyof PaymentGateway;
  at: Date;
  input: unknown;
}

interface FakeAuthorization {
  id: string;
  status: AuthorizationStatus;
  captureId: string | null;
}

interface FakeCapture {
  id: string;
  status: "COMPLETED" | "PENDING" | "DECLINED";
}

export interface FakeOrder {
  id: string;
  intent: PaymentIntent;
  amountCents: Cents;
  invoiceId: string;
  vaultId: string;
  createdAt: Date;
  /** CAPTURE intent: the one-step capture. AUTHORIZE intent: the capture of the authorization. */
  capture: FakeCapture | null;
  authorization: FakeAuthorization | null;
  declined: boolean;
}

interface RequestRecord {
  at: Date;
  /** What the request created; `result` is replayed when it created nothing. */
  orderId: string | null;
  captureOf: string | null;
  result: OrderResult | CaptureResult | VoidResult;
}

interface FakeSetup {
  reference: string;
  approved: boolean;
  vaultId: string | null;
  customerId: string;
}

export class FakePaymentGateway implements PaymentGateway {
  readonly calls: FakeCall[] = [];
  readonly #clock: Clock;
  readonly #orders = new Map<string, FakeOrder>();
  readonly #requests = new Map<string, RequestRecord>();
  readonly #setups = new Map<string, FakeSetup>();
  readonly #vaults = new Set<string>();
  readonly #script = {
    order: [] as OrderBehaviour[],
    capture: [] as CaptureBehaviour[],
    void: [] as VoidBehaviour[],
    lookup: [] as LookupBehaviour[],
    delete: [] as DeleteBehaviour[],
  };
  /**
   * PayPal's ids are unique for all time; a counter is unique only inside one process. This tag,
   * minted once per gateway, makes each one's ids its own, so a process that starts again over a
   * database holding the last one's rows cannot hand out an id those rows already carry.
   */
  readonly #tag = randomBytes(6).toString("hex").toUpperCase();
  #counter = 0;

  constructor(options: { clock: Clock }) {
    this.#clock = options.clock;
  }

  // ---------- scripting and inspection (tests only) ----------

  nextOrder(...behaviours: OrderBehaviour[]): void {
    this.#script.order.push(...behaviours);
  }

  nextCapture(...behaviours: CaptureBehaviour[]): void {
    this.#script.capture.push(...behaviours);
  }

  nextVoid(...behaviours: VoidBehaviour[]): void {
    this.#script.void.push(...behaviours);
  }

  nextLookup(...behaviours: LookupBehaviour[]): void {
    this.#script.lookup.push(...behaviours);
  }

  nextDelete(...behaviours: DeleteBehaviour[]): void {
    this.#script.delete.push(...behaviours);
  }

  /** A vaulted payment method that can be charged (normally created by the setup flow). */
  addVault(vaultId: string): void {
    this.#vaults.add(vaultId);
  }

  hasVault(vaultId: string): boolean {
    return this.#vaults.has(vaultId);
  }

  orders(): FakeOrder[] {
    return [...this.#orders.values()].map((o) => structuredClone(o));
  }

  ordersFor(invoiceId: string): FakeOrder[] {
    return this.orders().filter((o) => o.invoiceId === invoiceId);
  }

  callsTo(method: keyof PaymentGateway): FakeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  /** PayPal finishes something that was pending. */
  settle(orderId: string, outcome: "completed" | "declined"): void {
    const order = this.#order(orderId);
    if (order.intent === "CAPTURE" || order.capture !== null) {
      if (order.capture?.status !== "PENDING") {
        throw new Error(`order ${orderId} has no pending capture`);
      }
      order.capture.status = outcome === "completed" ? "COMPLETED" : "DECLINED";
      if (order.authorization !== null && outcome === "completed") {
        order.authorization.status = "CAPTURED";
      }
      return;
    }
    if (order.authorization?.status !== "PENDING") {
      throw new Error(`order ${orderId} has no pending authorization`);
    }
    order.authorization.status = outcome === "completed" ? "CREATED" : "DENIED";
  }

  /** The authorization lapses (or is voided) on PayPal's side, without Slip asking. */
  endAuthorization(authorizationId: string, status: "EXPIRED" | "VOIDED"): void {
    const order = this.#orderByAuthorization(authorizationId);
    if (order?.authorization === null || order === undefined) {
      throw new Error(`no authorization ${authorizationId}`);
    }
    order.authorization.status = status;
  }

  /** The owner approves at PayPal. `deferVault`: the vault id only arrives later (webhook). */
  approveSetup(reference: string, options: { deferVault?: boolean } = {}): void {
    const setup = this.#setups.get(reference);
    if (setup === undefined) {
      throw new Error(`no setup ${reference}`);
    }
    setup.approved = true;
    if (options.deferVault !== true) {
      this.#vaultSetup(setup);
    }
  }

  /** Creates the deferred vault token and returns the webhook PayPal would send about it. */
  deliverDeferredVault(reference: string): GatewayEvent {
    const setup = this.#setups.get(reference);
    if (setup === undefined || !setup.approved) {
      throw new Error(`setup ${reference} is not approved`);
    }
    const vaultId = this.#vaultSetup(setup);
    return {
      kind: "vault-token-created",
      vaultId,
      customerId: setup.customerId,
      setupReference: reference,
    };
  }

  /** A webhook delivery as PayPal would send it about `event`, signed so `verifyWebhook` passes. */
  webhook(
    event: GatewayEvent,
    options: { id?: string; signed?: boolean } = {},
  ): { id: string; eventType: string; request: WebhookRequest; payload: unknown } {
    const id = options.id ?? `WH-${this.#next()}`;
    const eventType = `FAKE.${event.kind.toUpperCase()}`;
    const payload = { id, event_type: eventType, fake_event: event };
    return {
      id,
      eventType,
      payload,
      request: {
        headers: {
          "paypal-transmission-sig": options.signed === false ? "forged" : "fake-valid",
        },
        rawBody: JSON.stringify(payload),
      },
    };
  }

  // ---------- PaymentGateway ----------

  async createOrder(input: CreateOrderInput, signal: AbortSignal): Promise<OrderResult> {
    this.#log("createOrder", input);
    const replay = this.#replay(input.requestId);
    if (replay !== undefined) {
      return replay.orderId === null
        ? (replay.result as OrderResult)
        : this.#orderResult(this.#order(replay.orderId));
    }
    const behaviour = this.#script.order.shift() ?? "ok";
    if (behaviour === "timeout-before-commit") {
      await untilAborted(signal);
      return { kind: "unknown", reason: "timeout before PayPal received the request" };
    }
    if (behaviour === "server-error") {
      return { kind: "unknown", reason: "PayPal answered 500" };
    }
    if (behaviour === "duplicate-invoice" || this.#invoiceUsed(input.invoiceId)) {
      return { kind: "duplicate-invoice", reason: "DUPLICATE_INVOICE_ID" };
    }
    if (behaviour === "payer-action-required") {
      const result: OrderResult = {
        kind: "payer-action-required",
        orderId: null,
        approveUrl: "https://fake.paypal.test/reapprove",
      };
      this.#remember(input.requestId, { orderId: null, captureOf: null, result });
      return result;
    }

    const order: FakeOrder = {
      id: `ORDER-${this.#next()}`,
      intent: input.intent,
      amountCents: input.amountCents,
      invoiceId: input.invoiceId,
      vaultId: input.vaultId,
      createdAt: this.#clock.now(),
      capture: null,
      authorization: null,
      declined: false,
    };
    const deleted = !this.#vaults.has(input.vaultId);
    if (behaviour === "decline" || deleted) {
      order.declined = true;
    } else if (input.intent === "CAPTURE") {
      order.capture = {
        id: `CAP-${this.#next()}`,
        status: behaviour === "pending" ? "PENDING" : "COMPLETED",
      };
    } else {
      order.authorization = {
        id: `AUTH-${this.#next()}`,
        status: behaviour === "pending" ? "PENDING" : "CREATED",
        captureId: null,
      };
    }
    this.#orders.set(order.id, order);
    const result = deleted
      ? ({ kind: "declined", orderId: order.id, reason: "vault token deleted" } as const)
      : this.#orderResult(order);
    this.#remember(input.requestId, { orderId: order.id, captureOf: null, result });
    if (behaviour === "timeout-after-commit") {
      await untilAborted(signal);
      return { kind: "unknown", reason: "timeout after PayPal committed" };
    }
    return result;
  }

  async getOrder(orderId: string, _signal: AbortSignal): Promise<OrderResult> {
    this.#log("getOrder", { orderId });
    const order = this.#orders.get(orderId);
    return order === undefined
      ? { kind: "unknown", reason: "RESOURCE_NOT_FOUND" }
      : this.#orderResult(order);
  }

  async findOrderByInvoice(
    input: FindOrderInput,
    _signal: AbortSignal,
  ): Promise<OrderLookupResult> {
    this.#log("findOrderByInvoice", input);
    if (this.#script.lookup.shift() === "unknown") {
      return { kind: "unknown", reason: "Transaction Search unavailable" };
    }
    const visibleBefore = this.#clock.now().getTime() - REPORTING_LAG_MS;
    const order = [...this.#orders.values()].find(
      (o) =>
        o.invoiceId === input.invoiceId &&
        o.amountCents === input.amountCents &&
        o.createdAt.getTime() <= visibleBefore &&
        o.createdAt.getTime() >= input.from.getTime() &&
        o.createdAt.getTime() <= input.to.getTime(),
    );
    return order === undefined
      ? { kind: "not-found" }
      : { kind: "found", order: this.#orderResult(order) };
  }

  /**
   * Everything PayPal would have recorded in the window, with the same three-hour lag the real
   * reporting has: an order younger than that is simply not there yet, which is the case a
   * reconcile must not mistake for money gone missing.
   */
  async listSettlements(
    window: { from: Date; to: Date },
    _signal: AbortSignal,
  ): Promise<SettlementsResult> {
    this.#log("listSettlements", window);
    if (window.from.getTime() > window.to.getTime()) {
      // A list is an answer about the window. An empty one for a window that cannot exist would
      // read as "PayPal has no record of any of this", which is the opposite of the truth.
      return { kind: "unknown", reason: "the search window ends before it starts" };
    }
    if (this.#script.lookup.shift() === "unknown") {
      return { kind: "unknown", reason: "Transaction Search unavailable" };
    }
    const visibleBefore = this.#clock.now().getTime() - REPORTING_LAG_MS;
    const records: SettlementRecord[] = [];
    for (const order of this.#orders.values()) {
      const at = order.createdAt.getTime();
      if (at > visibleBefore || at < window.from.getTime() || at > window.to.getTime()) {
        continue;
      }
      const kind = settledAs(order);
      if (kind !== null) {
        records.push({
          invoiceId: order.invoiceId,
          amountCents: kind === "reversed" ? -order.amountCents : order.amountCents,
          kind,
          transactionId: order.capture?.id ?? order.authorization?.id ?? null,
        });
      }
    }
    return { kind: "listed", records };
  }

  async captureAuthorization(
    input: CaptureAuthorizationInput,
    signal: AbortSignal,
  ): Promise<CaptureResult> {
    this.#log("captureAuthorization", input);
    const replay = this.#replay(input.requestId);
    if (replay?.captureOf !== null && replay?.captureOf !== undefined) {
      return this.#captureResult(replay.captureOf);
    }
    const order = this.#orderByAuthorization(input.authorizationId);
    const authorization = order?.authorization;
    if (order === undefined || authorization === null || authorization === undefined) {
      return { kind: "unknown", reason: "RESOURCE_NOT_FOUND" };
    }
    if (authorization.status === "CAPTURED") {
      return this.#captureResult(order.id);
    }
    if (authorization.status !== "CREATED") {
      return { kind: "declined", reason: `AUTHORIZATION_${authorization.status}` };
    }
    const behaviour = this.#script.capture.shift() ?? "ok";
    if (behaviour === "timeout-before-commit") {
      await untilAborted(signal);
      return { kind: "unknown", reason: "timeout before PayPal received the request" };
    }
    if (behaviour === "decline") {
      // The authorization stays alive; the caller asks before voiding it.
      return { kind: "declined", reason: "CAPTURE_DECLINED" };
    }
    order.capture = {
      id: `CAP-${this.#next()}`,
      status: behaviour === "pending" ? "PENDING" : "COMPLETED",
    };
    authorization.status = "CAPTURED";
    authorization.captureId = order.capture.id;
    this.#remember(input.requestId, {
      orderId: order.id,
      captureOf: order.id,
      result: this.#captureResult(order.id),
    });
    if (behaviour === "timeout-after-commit") {
      await untilAborted(signal);
      return { kind: "unknown", reason: "timeout after PayPal committed" };
    }
    return this.#captureResult(order.id);
  }

  async voidAuthorization(input: VoidAuthorizationInput, signal: AbortSignal): Promise<VoidResult> {
    this.#log("voidAuthorization", input);
    const order = this.#orderByAuthorization(input.authorizationId);
    const authorization = order?.authorization;
    if (authorization === null || authorization === undefined) {
      return { kind: "unknown", reason: "RESOURCE_NOT_FOUND" };
    }
    if (authorization.status === "VOIDED" && this.#replay(input.requestId) !== undefined) {
      return { kind: "voided" };
    }
    if (authorization.status !== "CREATED") {
      return {
        kind: "not-voidable",
        status: authorization.status,
        captureId: authorization.captureId,
      };
    }
    const behaviour = this.#script.void.shift() ?? "ok";
    if (behaviour === "timeout-before-commit") {
      await untilAborted(signal);
      return { kind: "unknown", reason: "timeout before PayPal received the request" };
    }
    authorization.status = "VOIDED";
    this.#remember(input.requestId, { orderId: null, captureOf: null, result: { kind: "voided" } });
    if (behaviour === "timeout-after-commit") {
      await untilAborted(signal);
      return { kind: "unknown", reason: "timeout after PayPal committed" };
    }
    return { kind: "voided" };
  }

  async getAuthorization(
    authorizationId: string,
    _signal: AbortSignal,
  ): Promise<AuthorizationResult> {
    this.#log("getAuthorization", { authorizationId });
    const authorization = this.#orderByAuthorization(authorizationId)?.authorization;
    return authorization === null || authorization === undefined
      ? { kind: "unknown", reason: "RESOURCE_NOT_FOUND" }
      : { kind: "found", status: authorization.status, captureId: authorization.captureId };
  }

  async startVaultSetup(
    input: StartVaultSetupInput,
    _signal: AbortSignal,
  ): Promise<StartVaultSetupResult> {
    this.#log("startVaultSetup", input);
    const reference = `SETUP-${this.#next()}`;
    this.#setups.set(reference, {
      reference,
      approved: false,
      vaultId: null,
      customerId: `CUST-${this.#next()}`,
    });
    return {
      kind: "started",
      reference,
      approveUrl: `https://fake.paypal.test/approve/${reference}`,
    };
  }

  async completeVaultSetup(
    input: { reference: string; requestId: RequestId },
    _signal: AbortSignal,
  ): Promise<CompleteVaultSetupResult> {
    this.#log("completeVaultSetup", input);
    const setup = this.#setups.get(input.reference);
    if (setup === undefined) {
      return { kind: "failed", reason: "unknown setup reference" };
    }
    if (!setup.approved) {
      return { kind: "not-approved" };
    }
    return setup.vaultId === null
      ? { kind: "pending", customerId: setup.customerId }
      : { kind: "vaulted", vaultId: setup.vaultId, customerId: setup.customerId };
  }

  async deleteVaultToken(vaultId: string, _signal: AbortSignal): Promise<DeleteVaultResult> {
    this.#log("deleteVaultToken", { vaultId });
    if (this.#script.delete.shift() === "fail") {
      return { kind: "failed", reason: "PayPal answered 503" };
    }
    if (!this.#vaults.delete(vaultId)) {
      return { kind: "already-gone" };
    }
    return { kind: "deleted" };
  }

  async verifyWebhook(request: WebhookRequest, _signal: AbortSignal): Promise<boolean> {
    this.#log("verifyWebhook", { headers: request.headers });
    return request.headers["paypal-transmission-sig"] === "fake-valid";
  }

  interpretWebhook(payload: unknown): GatewayEvent {
    const event = (payload as { fake_event?: GatewayEvent } | null)?.fake_event;
    if (event === undefined || typeof event !== "object" || typeof event.kind !== "string") {
      const eventType = (payload as { event_type?: unknown } | null)?.event_type;
      return { kind: "ignored", eventType: typeof eventType === "string" ? eventType : "UNKNOWN" };
    }
    return structuredClone(event);
  }

  // ---------- internals ----------

  #next(): string {
    this.#counter += 1;
    return `${this.#tag}-${this.#counter}`;
  }

  #log(method: keyof PaymentGateway, input: unknown): void {
    this.calls.push({ method, at: this.#clock.now(), input: structuredClone(input) });
  }

  #replay(requestId: string): RequestRecord | undefined {
    const record = this.#requests.get(requestId);
    if (record === undefined) {
      return undefined;
    }
    if (this.#clock.now().getTime() - record.at.getTime() >= REQUEST_ID_RETENTION_MS) {
      this.#requests.delete(requestId);
      return undefined;
    }
    return record;
  }

  #remember(requestId: string, record: Omit<RequestRecord, "at">): void {
    this.#requests.set(requestId, { ...record, at: this.#clock.now() });
  }

  #invoiceUsed(invoiceId: string): boolean {
    return [...this.#orders.values()].some((o) => o.invoiceId === invoiceId);
  }

  #order(orderId: string): FakeOrder {
    const order = this.#orders.get(orderId);
    if (order === undefined) {
      throw new Error(`no order ${orderId}`);
    }
    return order;
  }

  #orderByAuthorization(authorizationId: string): FakeOrder | undefined {
    return [...this.#orders.values()].find((o) => o.authorization?.id === authorizationId);
  }

  #vaultSetup(setup: FakeSetup): string {
    if (setup.vaultId === null) {
      setup.vaultId = `VAULT-${this.#next()}`;
      this.#vaults.add(setup.vaultId);
    }
    return setup.vaultId;
  }

  #orderResult(order: FakeOrder): OrderResult {
    if (order.declined) {
      return { kind: "declined", orderId: order.id, reason: "INSTRUMENT_DECLINED" };
    }
    if (order.intent === "CAPTURE") {
      const capture = order.capture as FakeCapture;
      if (capture.status === "COMPLETED") {
        return { kind: "captured", orderId: order.id, captureId: capture.id };
      }
      if (capture.status === "PENDING") {
        return { kind: "pending", orderId: order.id, captureId: capture.id, authorizationId: null };
      }
      return { kind: "declined", orderId: order.id, reason: "CAPTURE_DECLINED" };
    }
    const authorization = order.authorization as FakeAuthorization;
    switch (authorization.status) {
      case "CREATED":
        return { kind: "authorized", orderId: order.id, authorizationId: authorization.id };
      case "PENDING":
        return {
          kind: "pending",
          orderId: order.id,
          captureId: null,
          authorizationId: authorization.id,
        };
      case "VOIDED":
      case "EXPIRED":
        return { kind: "voided", orderId: order.id, authorizationId: authorization.id };
      case "DENIED":
        return { kind: "declined", orderId: order.id, reason: "AUTHORIZATION_DENIED" };
      default:
        return order.capture?.status === "COMPLETED"
          ? { kind: "captured", orderId: order.id, captureId: order.capture.id }
          : {
              kind: "pending",
              orderId: order.id,
              captureId: order.capture?.id ?? null,
              authorizationId: authorization.id,
            };
    }
  }

  #captureResult(orderId: string): CaptureResult {
    const capture = this.#order(orderId).capture;
    if (capture === null) {
      return { kind: "unknown", reason: "no capture" };
    }
    if (capture.status === "COMPLETED") {
      return { kind: "captured", captureId: capture.id };
    }
    if (capture.status === "PENDING") {
      return { kind: "pending", captureId: capture.id };
    }
    return { kind: "declined", reason: "CAPTURE_DECLINED" };
  }
}

function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

/**
 * What PayPal's record would say about one order. An authorization that was voided leaves a
 * reversal behind; one still open affects no balance but is reported, which is why Slip asks for
 * `balance_affecting_records_only=N`.
 */
function settledAs(order: FakeOrder): SettlementRecord["kind"] | null {
  if (order.declined) {
    return "denied";
  }
  if (order.capture !== null) {
    return order.capture.status === "COMPLETED"
      ? "settled"
      : order.capture.status === "PENDING"
        ? "pending"
        : "denied";
  }
  if (order.authorization !== null) {
    return order.authorization.status === "VOIDED" ? "reversed" : "pending";
  }
  return null;
}
