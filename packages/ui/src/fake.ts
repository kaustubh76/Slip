import type {
  AgentCard,
  Holds,
  MandateSummary,
  PolicyView,
  ReceiptDetail,
  ReceiptPage,
  ReceiptRow,
} from "@slip/receipt";
import {
  type ReceiptsQuery,
  type SlipClient,
  SlipClientError,
  type SlipClientErrorKind,
} from "./data/client.js";
import type {
  DecisionAnswer,
  IssueKeyAnswer,
  LimitsAnswer,
  LimitsInput,
  PreviewAnswer,
  RevokeKeyAnswer,
  RevokeMandateAnswer,
  SlipCommands,
} from "./data/commands.js";
import {
  agentCards,
  heldDetail,
  holdsTray,
  mandateSummary,
  policyVersions,
  receiptDetail,
  rollRows,
} from "./seed/index.js";

/**
 * A whole Slip with nothing behind it (`@slip/ui/fake`).
 *
 * `SlipProvider` is the seam a host plugs into, and until now the only thing that fitted it was
 * `createSlipClient` — the real HTTP client. So seeing any screen meant running the app, a
 * database and three outside services, and then *driving* the thing into the state you wanted to
 * look at. Every hook test worked around that by hand-rolling a partial client with an `unused`
 * thrower and `commands: {} as SlipCommands`, a cast that throws away the type it claims.
 *
 * This is the whole interface, seeded from `./seed`, and scriptable for the states that are
 * otherwise the hardest to reach:
 *
 * - `delay(ms)` — every read waits, so a loading state exists long enough to design.
 * - `failNext(kind)` — the next read throws that `SlipClientError`, so each error branch is
 *   reachable without breaking a server.
 * - `refuseNext(command, answer)` — a command refuses, conflicts on a stale version, or answers
 *   `unknown`, which is what `safeCommands` manufactures when an answer is lost and is close to
 *   impossible to produce on purpose any other way.
 * - `advanceStamp()` — moves the change stamp that `live.ts` and the roll watch.
 * - `calls` — what the UI asked for, in order.
 *
 * It is a fake, not a stub: it holds state, and a command changes what the next read returns.
 */

/** Every method name a caller can be scripted against or asserted on. */
export type SlipCall = keyof Omit<SlipClient, "commands"> | keyof SlipCommands;

export interface FakeSlipState {
  rows: ReceiptRow[];
  details: Record<string, ReceiptDetail>;
  holds: Holds;
  agents: AgentCard[];
  policies: PolicyView[];
  mandate: MandateSummary;
}

/** The default Slip: a roll with every outcome on it, one hold waiting, two agents, two versions. */
export function seedState(): FakeSlipState {
  const detail = receiptDetail();
  const held = heldDetail();
  return {
    rows: rollRows(),
    details: { [detail.view.receiptId]: detail, [held.view.receiptId]: held },
    holds: holdsTray(),
    agents: agentCards(),
    policies: policyVersions(),
    mandate: mandateSummary(),
  };
}

const MESSAGE: Record<SlipClientErrorKind, [number, string]> = {
  "signed-out": [401, "Slip signed you out."],
  "not-found": [404, "There is nothing here."],
  server: [500, "Slip could not be reached."],
  invalid: [400, "Slip could not read that."],
};

export class FakeSlipClient implements SlipClient {
  readonly calls: SlipCall[] = [];
  readonly commands: SlipCommands;

  private state: FakeSlipState;
  private latencyMs = 0;
  private rowsPerPage = 20;
  private pendingFailure: SlipClientErrorKind | null = null;
  private refusals = new Map<SlipCall, unknown>();
  private stampValue = "stamp-1";
  private issued = 0;

  constructor(state: Partial<FakeSlipState> = {}) {
    this.state = { ...seedState(), ...state };
    this.commands = {
      previewApproval: (id) =>
        this.command<PreviewAnswer>("previewApproval", () => this.preview(id)),
      approveHold: (id, cents) =>
        this.command<DecisionAnswer>("approveHold", () => this.decide(id, cents)),
      declineHold: (id) => this.command<DecisionAnswer>("declineHold", () => this.decline(id)),
      updateLimits: (input, version) =>
        this.command<LimitsAnswer>("updateLimits", () => this.limits(input, version)),
      revokeMandate: (typed) =>
        this.command<RevokeMandateAnswer>("revokeMandate", () => this.revoke(typed)),
      issueKey: (name) => this.command<IssueKeyAnswer>("issueKey", () => this.issue(name)),
      revokeKey: (id) => this.command<RevokeKeyAnswer>("revokeKey", () => this.revokeKey(id)),
    };
  }

  // --- scripting -------------------------------------------------------------------------------

  /** Every read waits this long, so a loading state can be seen rather than imagined. */
  delay(ms: number): this {
    this.latencyMs = ms;
    return this;
  }

  /**
   * How many rows a page of the roll holds. The server decides this, not the caller — `useReceipts`
   * sends no limit and follows `next` — so paging can only be exercised from this side.
   */
  pageSize(rows: number): this {
    this.rowsPerPage = Math.max(1, rows);
    return this;
  }

  /** The next read throws. One read only: an error branch is a state, not a mode. */
  failNext(kind: SlipClientErrorKind): this {
    this.pendingFailure = kind;
    return this;
  }

  /** The next call to `command` answers `answer` instead of doing the work. */
  refuseNext<K extends keyof SlipCommands>(
    command: K,
    answer: Awaited<ReturnType<SlipCommands[K]>>,
  ): this {
    this.refusals.set(command, answer);
    return this;
  }

  /** Something changed under the mandate, as far as anything watching the stamp can tell. */
  advanceStamp(): this {
    this.stampValue = `stamp-${Number(this.stampValue.split("-")[1] ?? 1) + 1}`;
    return this;
  }

  /** What the client currently holds, for a test that wants to assert on a command's effect. */
  current(): FakeSlipState {
    return this.state;
  }

  asked(call: SlipCall): number {
    return this.calls.filter((name) => name === call).length;
  }

  // --- reads -----------------------------------------------------------------------------------

  async receipts(query: ReceiptsQuery = {}, signal?: AbortSignal): Promise<ReceiptPage> {
    await this.read("receipts", signal);
    const limit = query.limit ?? this.rowsPerPage;
    const mine = query.agent
      ? this.state.rows.filter((row) => row.agent.id === query.agent)
      : this.state.rows;
    const from = query.before
      ? mine.findIndex((row) => row.view.receiptId === query.before) + 1
      : 0;
    const page = mine.slice(from, from + limit);
    return {
      rows: page,
      next: from + limit < mine.length ? (page.at(-1)?.view.receiptId ?? null) : null,
    };
  }

  async receipt(id: string, signal?: AbortSignal): Promise<ReceiptDetail> {
    await this.read("receipt", signal);
    const found = this.state.details[id];
    if (found !== undefined) {
      return found;
    }
    const row = this.state.rows.find((candidate) => candidate.view.receiptId === id);
    if (row === undefined) {
      throw this.error("not-found");
    }
    // A row with no canned detail still has to answer, as the server would.
    return { ...row, parent: null, followUp: null, timeline: [], offers: [] };
  }

  async holds(signal?: AbortSignal): Promise<Holds> {
    await this.read("holds", signal);
    return this.state.holds;
  }

  async agents(signal?: AbortSignal): Promise<AgentCard[]> {
    await this.read("agents", signal);
    return this.state.agents;
  }

  async policies(signal?: AbortSignal): Promise<PolicyView[]> {
    await this.read("policies", signal);
    return this.state.policies;
  }

  async mandate(signal?: AbortSignal): Promise<MandateSummary> {
    await this.read("mandate", signal);
    return this.state.mandate;
  }

  async stamp(signal?: AbortSignal): Promise<string> {
    await this.read("stamp", signal);
    return this.stampValue;
  }

  // --- the work behind the commands -------------------------------------------------------------

  private preview(id: string): PreviewAnswer {
    const row = this.pending(id);
    if (row === undefined) {
      return { status: "refused", reason: "NOT_PENDING", message: "That hold is already decided." };
    }
    return {
      status: "preview",
      kind: "capture",
      // What PayPal is holding is what approving captures; falling back to the listed price keeps
      // a hold with no reservation (the follow-up case) answering with something true.
      amountCents: row.view.reservedCents ?? row.view.chosen?.priceCents ?? 0,
      store: row.view.chosen?.store ?? "a store",
    };
  }

  private decide(id: string, expectedAmountCents: number): DecisionAnswer {
    const row = this.pending(id);
    if (row === undefined) {
      return { status: "refused", reason: "NOT_PENDING", message: "That hold is already decided." };
    }
    const now = row.view.reservedCents ?? row.view.chosen?.priceCents ?? 0;
    if (now !== expectedAmountCents) {
      return {
        status: "refused",
        reason: "PRICE_CHANGED",
        message: "The price moved while you were looking.",
        amountCents: now,
      };
    }
    this.settle(id);
    return { status: "done", view: row.view, followUp: null };
  }

  private decline(id: string): DecisionAnswer {
    const row = this.pending(id);
    if (row === undefined) {
      return { status: "refused", reason: "NOT_PENDING", message: "That hold is already decided." };
    }
    this.settle(id);
    return { status: "done", view: row.view, followUp: null };
  }

  private limits(input: LimitsInput, basedOnVersion: number): LimitsAnswer {
    const latest = this.state.policies[0];
    if (latest !== undefined && latest.version !== basedOnVersion) {
      return {
        status: "refused",
        reason: "STALE_VERSION",
        message: "Someone changed the limits while you were editing.",
      };
    }
    const version = (latest?.version ?? 0) + 1;
    const next: PolicyView = {
      version,
      maxOverpayPctHundredths: Math.round(input.maxOverpayPct * 100),
      maxOverpayAbsCents: Math.round(input.maxOverpayDollars * 100),
      flagPctHundredths: Math.round(input.flagPct * 100),
      orderCapCents: Math.round(input.orderCapDollars * 100),
      snapshotMaxAgeMs: Math.round(input.snapshotMaxAgeMinutes * 60_000),
    };
    this.state = {
      ...this.state,
      policies: [next, ...this.state.policies],
      mandate: { ...this.state.mandate, policyVersion: version },
    };
    this.advanceStamp();
    return { status: "updated", version };
  }

  private revoke(typed: string): RevokeMandateAnswer {
    if (typed !== "REVOKE") {
      return { status: "refused", reason: "NOT_CONFIRMED", message: "Type REVOKE to confirm." };
    }
    const declined = this.state.holds.pending.length;
    this.state = {
      ...this.state,
      holds: { pending: [], decided: [...this.state.holds.pending, ...this.state.holds.decided] },
      mandate: { ...this.state.mandate, status: "REVOKED", hasSavedMethod: false, pendingHolds: 0 },
    };
    this.advanceStamp();
    return { status: "revoked", holdsDeclined: declined, vault: "deleted" };
  }

  private issue(name: string): IssueKeyAnswer {
    this.issued += 1;
    const prefix = `slip_fake${this.issued}`;
    this.state = {
      ...this.state,
      mandate: { ...this.state.mandate, agents: this.state.mandate.agents + 1 },
    };
    this.advanceStamp();
    // Shaped like a key and obviously not one, because this string is drawn on a page.
    return { status: "issued", name, apiKey: `${prefix}_not_a_real_key` };
  }

  private revokeKey(id: string): RevokeKeyAnswer {
    const agents = this.state.agents.map((card) =>
      card.agent.id === id
        ? { ...card, agent: { ...card.agent, revokedAt: "2026-10-29T12:00:00.000Z" } }
        : card,
    );
    this.state = { ...this.state, agents };
    this.advanceStamp();
    return { status: "revoked" };
  }

  // --- plumbing ---------------------------------------------------------------------------------

  private pending(id: string): ReceiptRow | undefined {
    return this.state.holds.pending.find((row) => row.view.receiptId === id);
  }

  /** Moves a hold out of the tray, so the next read of `holds` differs. */
  private settle(id: string): void {
    const row = this.pending(id);
    if (row === undefined) {
      return;
    }
    this.state = {
      ...this.state,
      holds: {
        pending: this.state.holds.pending.filter((other) => other !== row),
        decided: [row, ...this.state.holds.decided],
      },
      mandate: {
        ...this.state.mandate,
        pendingHolds: Math.max(0, this.state.mandate.pendingHolds - 1),
      },
    };
    this.advanceStamp();
  }

  private error(kind: SlipClientErrorKind): SlipClientError {
    const [status, message] = MESSAGE[kind];
    return new SlipClientError(kind, status, message);
  }

  private async read(call: SlipCall, signal?: AbortSignal): Promise<void> {
    this.calls.push(call);
    await this.wait(signal);
    const kind = this.pendingFailure;
    if (kind !== null) {
      this.pendingFailure = null;
      throw this.error(kind);
    }
  }

  private async command<T>(call: SlipCall, work: () => T): Promise<T> {
    this.calls.push(call);
    await this.wait();
    const refusal = this.refusals.get(call);
    if (refusal !== undefined) {
      this.refusals.delete(call);
      return refusal as T;
    }
    return work();
  }

  private async wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      throw new DOMException("aborted", "AbortError");
    }
    if (this.latencyMs <= 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, this.latencyMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }
}

export { KitGallery } from "./components/KitGallery.js";
export * from "./seed/index.js";
