import { createHash } from "node:crypto";
import type {
  FetchProductResult,
  Offer,
  OffersFailure,
  OffersSource,
  SelectedOption,
} from "@slip/domain";

/** A product the fake catalogue lists. */
export interface FakeProduct {
  productId: string;
  title?: string;
  selectedOptions?: SelectedOption[];
  offers: Offer[];
}

/** What the next call does instead of answering normally. `hang` waits until the caller aborts. */
export type FakeOffersFailure = OffersFailure | "hang";

/**
 * An in-memory catalogue standing in for Channel3. Products are set by the test; failures can be
 * scripted for the next call or for every call (`goDown`). Every call is logged.
 */
export class FakeOffersSource implements OffersSource {
  readonly calls: string[] = [];
  readonly #products = new Map<string, FakeProduct>();
  readonly #next: FakeOffersFailure[] = [];
  #down: OffersFailure | null = null;

  setProduct(product: FakeProduct): void {
    this.#products.set(product.productId, structuredClone(product));
  }

  removeProduct(productId: string): void {
    this.#products.delete(productId);
  }

  /** The next call fails this way (queued; one per call). */
  failNext(failure: FakeOffersFailure): void {
    this.#next.push(failure);
  }

  /** Every call fails this way until `comeBack`. */
  goDown(reason: OffersFailure = "UNAVAILABLE"): void {
    this.#down = reason;
  }

  comeBack(): void {
    this.#down = null;
  }

  async fetchProduct(productId: string, signal: AbortSignal): Promise<FetchProductResult> {
    this.calls.push(productId);
    if (signal.aborted) {
      return { ok: false, reason: "TIMEOUT" };
    }
    const scripted = this.#next.shift();
    if (scripted === "hang") {
      await untilAborted(signal);
      return { ok: false, reason: "TIMEOUT" };
    }
    if (scripted !== undefined) {
      return { ok: false, reason: scripted, detail: "scripted by the test" };
    }
    if (this.#down !== null) {
      return { ok: false, reason: this.#down, detail: "the fake catalogue is down" };
    }
    const product = this.#products.get(productId);
    if (product === undefined) {
      return { ok: false, reason: "NOT_FOUND", detail: "Product not found" };
    }
    const raw = { source: "fake-channel3", product: structuredClone(product) };
    return {
      ok: true,
      product: {
        productId,
        title: product.title ?? `Product ${productId}`,
        selectedOptions: structuredClone(product.selectedOptions ?? []),
        offers: structuredClone(product.offers),
        raw,
        rawHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
      },
    };
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
