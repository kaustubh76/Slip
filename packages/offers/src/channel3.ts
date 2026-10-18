import { createHash } from "node:crypto";
import {
  commissionToBps,
  type FetchProductResult,
  type Offer,
  type OffersFailure,
  type OffersSource,
  type ProductOffers,
  parseUsdNumberToCents,
  type SelectedOption,
} from "@slip/domain";
import { createJsonClient, type Fetch, type JsonClient } from "@slip/http";
import { z } from "zod";

/**
 * Channel3, the catalogue Slip prices against: `GET /v1/products/{id}`, which lists every
 * merchant's offer for one product id and costs no credit (search does, so this never searches).
 *
 * Two rules shape the mapping. **Nothing here throws**: every documented failure becomes an
 * `OffersFailure`, because a purchase that cannot be priced is held for the owner, not crashed.
 * And **a listing Slip cannot read is not a listing it guesses at**: an offer whose price, currency
 * or availability does not parse is dropped from the comparison rather than priced wrongly, and an
 * answer that is not a product at all is `UNAVAILABLE`.
 */

export const CHANNEL3_BASE_URL = "https://api.trychannel3.com";

export interface Channel3Options {
  apiKey: string;
  /** Overridden in tests and for a staging base. */
  baseUrl?: string;
  fetch?: Fetch;
  client?: JsonClient;
  /** Attributes clicks and sales to one of our owners, if Channel3 ever reports per-user. */
  userId?: string;
}

/**
 * What Slip reads from a Channel3 product. The schema checks the *shape* — an object with a list of
 * offers — and nothing more: every field is `maybe`, because a field's own validation happens below
 * where a bad value has a defined consequence (no price, or the offer dropped). A stricter schema
 * would reject a whole product over one merchant's missing field, which is the opposite of what a
 * price comparison wants. Everything else in the response is ignored but kept whole in `raw`.
 */
const maybe = z.unknown().optional();

const PriceSchema = z.object({ price: maybe, currency: maybe }).loose();

const RawOfferSchema = z
  .object({
    url: maybe,
    domain: maybe,
    price: PriceSchema.optional().nullable(),
    availability: maybe,
    condition: maybe,
    max_commission_rate: maybe,
    /** Some merchants carry their own listing copy; the product's description is not a substitute. */
    title: maybe,
    description: maybe,
  })
  .loose();

const VariantsSchema = z
  .object({
    selected: z
      .array(z.object({ name: maybe, label: maybe }).loose())
      .optional()
      .nullable(),
  })
  .loose();

/** The envelope must be a product with a list of offers; anything else is not an answer. */
const ProductSchema = z
  .object({
    id: maybe,
    title: maybe,
    offers: z.array(RawOfferSchema),
    variants: VariantsSchema.optional().nullable(),
  })
  .loose();

export function createChannel3Offers(options: Channel3Options): OffersSource {
  const base = (options.baseUrl ?? CHANNEL3_BASE_URL).replace(/\/+$/, "");
  const client =
    options.client ??
    createJsonClient({
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      headers: {
        "x-api-key": options.apiKey,
        ...(options.userId === undefined ? {} : { "x-user-id": options.userId }),
      },
    });

  return {
    async fetchProduct(productId, signal): Promise<FetchProductResult> {
      if (signal.aborted) {
        return { ok: false, reason: "TIMEOUT", detail: "the deadline passed before the call" };
      }
      // USD only: Slip compares nothing else, so asking for another currency would be a lie.
      const url = `${base}/v1/products/${encodeURIComponent(productId)}?currency=USD`;
      const result = await client.send({ url, signal });
      if (result.outcome === "aborted") {
        return { ok: false, reason: "TIMEOUT", detail: "Channel3 did not answer in time" };
      }
      if (result.outcome === "unreachable") {
        return { ok: false, reason: "UNAVAILABLE", detail: result.detail };
      }
      if (result.status !== 200) {
        return {
          ok: false,
          reason: failureFor(result.status),
          detail: detailOf(result.status),
        };
      }
      const parsed = ProductSchema.safeParse(result.body);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "UNAVAILABLE",
          detail: "Channel3 answered with something that is not a product",
        };
      }
      return { ok: true, product: toProductOffers(productId, parsed.data, result.body) };
    },
  };
}

/** Channel3's documented statuses, each mapped to what the owner should see happen. */
function failureFor(status: number): OffersFailure {
  switch (status) {
    case 404:
      return "NOT_FOUND";
    case 402:
      return "OUT_OF_CREDITS";
    case 429:
      return "RATE_LIMITED";
    default:
      // 401 a bad key, 422 a rejected request, 5xx Channel3 itself: all "no prices right now".
      return "UNAVAILABLE";
  }
}

/**
 * Why the call failed, in Slip's own words. Channel3's `detail` text is deliberately **not**
 * repeated: the body of a 401 is `"Invalid API key: ..."`, and this string is written to a log. A
 * service's free text is also not something to put in front of an owner — it is not Slip's voice,
 * and nothing stops it from containing a sentence aimed at whoever reads it. The status is the
 * diagnostic part, and it is kept.
 */
function detailOf(status: number): string {
  switch (status) {
    case 401:
      return "Channel3 answered 401: it did not accept the api key";
    case 402:
      return "Channel3 answered 402: there are no catalogue credits left";
    case 404:
      return "Channel3 answered 404: it has no such product";
    case 422:
      return "Channel3 answered 422: it rejected the request";
    case 429:
      return "Channel3 answered 429: too many requests";
    default:
      return `Channel3 answered ${status}`;
  }
}

function toProductOffers(
  productId: string,
  product: z.infer<typeof ProductSchema>,
  raw: unknown,
): ProductOffers {
  const offers: Offer[] = [];
  for (const candidate of product.offers) {
    const offer = toOffer(candidate);
    if (offer !== null) {
      offers.push(offer);
    }
  }
  return {
    productId,
    title: typeof product.title === "string" ? product.title : "",
    selectedOptions: toSelectedOptions(product.variants),
    offers,
    raw,
    rawHash: createHash("sha256").update(JSON.stringify(raw)).digest("hex"),
  };
}

/**
 * One merchant's offer, or null when it cannot take part in a price comparison. A missing URL,
 * domain or availability is not something to guess: an offer Slip kept with invented values could
 * become the "cheapest" one it tells an agent to buy.
 */
function toOffer(raw: z.infer<typeof RawOfferSchema>): Offer | null {
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const domain = typeof raw.domain === "string" ? raw.domain.trim().toLowerCase() : "";
  if (url === "" || domain === "" || !isHttpUrl(url)) {
    return null;
  }
  const availability =
    raw.availability === "InStock" || raw.availability === "OutOfStock" ? raw.availability : null;
  if (availability === null) {
    return null;
  }
  return {
    url,
    domain,
    // A price Slip cannot read is null, which makes the offer uncomparable rather than wrong.
    priceCents: toCents(raw.price?.price),
    currency: typeof raw.price?.currency === "string" ? raw.price.currency.toUpperCase() : "USD",
    availability,
    // Channel3 sends null for unknown and for the retired "refurbished": neither is new or used.
    condition: raw.condition === "new" || raw.condition === "used" ? raw.condition : null,
    commissionBps: commissionToBps(
      typeof raw.max_commission_rate === "number" ? raw.max_commission_rate : null,
    ),
    listingText: toListingText(raw),
  };
}

function toCents(price: unknown): Offer["priceCents"] {
  if (typeof price !== "number") {
    return null;
  }
  try {
    return parseUsdNumberToCents(price);
  } catch {
    // Zero, negative, or more than two decimals: unreadable, not zero.
    return null;
  }
}

/**
 * The text the steering check reads, and only ever this offer's own (D60). The product's shared
 * description would be identical across every merchant, so flagging it would accuse whichever
 * offer the agent happened to choose.
 */
function toListingText(raw: z.infer<typeof RawOfferSchema>): string | null {
  const parts = [raw.title, raw.description]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length === 0 ? null : parts.join("\n\n");
}

function toSelectedOptions(
  variants: z.infer<typeof VariantsSchema> | null | undefined,
): SelectedOption[] {
  const selected = variants?.selected;
  if (!Array.isArray(selected)) {
    return [];
  }
  const options: SelectedOption[] = [];
  for (const option of selected) {
    const name = typeof option.name === "string" ? option.name.trim() : "";
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (name !== "" && label !== "") {
      options.push({ name, label });
    }
  }
  return options;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
