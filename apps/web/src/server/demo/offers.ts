import "server-only";
import type { FetchProductResult, OffersSource } from "@slip/domain";
import type { FakeOffersSource, FakeProduct } from "@slip/offers/fake";

/**
 * The demo's Channel3: the in-memory catalogue, made safe for many visitors in one process. The
 * fake can only go down for everyone at once; here an outage belongs to one product, and every
 * visitor's products have ids of their own (see the catalogue), so one visitor's outage or price
 * change never reaches another's checkout.
 */
export class DemoOffers implements OffersSource {
  readonly #inner: FakeOffersSource;
  readonly #products = new Map<string, FakeProduct>();
  readonly #down = new Set<string>();

  constructor(inner: FakeOffersSource) {
    this.#inner = inner;
  }

  setProduct(product: FakeProduct): void {
    this.#products.set(product.productId, structuredClone(product));
    this.#inner.setProduct(product);
  }

  /** The product as the catalogue lists it now. */
  product(productId: string): FakeProduct | undefined {
    const product = this.#products.get(productId);
    return product === undefined ? undefined : structuredClone(product);
  }

  /** This product's listing cannot be fetched until it comes back. */
  setDown(productId: string, down: boolean): void {
    if (down) {
      this.#down.add(productId);
    } else {
      this.#down.delete(productId);
    }
  }

  isDown(productId: string): boolean {
    return this.#down.has(productId);
  }

  async fetchProduct(productId: string, signal: AbortSignal): Promise<FetchProductResult> {
    if (this.#down.has(productId)) {
      return { ok: false, reason: "UNAVAILABLE", detail: "simulated outage for this product" };
    }
    return this.#inner.fetchProduct(productId, signal);
  }
}
