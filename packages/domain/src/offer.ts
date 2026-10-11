import { z } from "zod";
import { uuidSchema } from "./ids.js";
import { PositiveCentsSchema } from "./money.js";

/** Channel3's literal values. */
export const AVAILABILITIES = ["InStock", "OutOfStock"] as const;
export const AvailabilitySchema = z.enum(AVAILABILITIES);
export type Availability = z.infer<typeof AvailabilitySchema>;

/** Channel3 sends `null` for unknown (and for the deprecated "refurbished"). */
export const CONDITIONS = ["new", "used"] as const;
export const ConditionSchema = z.enum(CONDITIONS).nullable();
export type Condition = z.infer<typeof ConditionSchema>;

/** One selected variant option, e.g. `{ name: "Color", label: "Black" }`. */
export const SelectedOptionSchema = z.object({
  name: z.string().trim().min(1),
  label: z.string().trim().min(1),
});
export type SelectedOption = z.infer<typeof SelectedOptionSchema>;

/** One merchant's listing of a product, as Slip stores it. Everything textual is untrusted. */
export const OfferSchema = z.object({
  url: z.url(),
  domain: z.string().trim().min(1),
  /** `null` when Channel3's price could not be parsed (missing, zero, negative, > 2 decimals). */
  priceCents: PositiveCentsSchema.nullable(),
  /** ISO 4217, upper case. Only "USD" is ever compared. */
  currency: z.string().length(3),
  availability: AvailabilitySchema,
  condition: ConditionSchema,
  /** Basis points from `max_commission_rate`; `null` when missing or outside [0, 1]. */
  commissionBps: z.number().int().min(0).max(10_000).nullable(),
  /** Listing text shown for this offer (title, description, badges). Untrusted input. */
  listingText: z.string().nullable(),
});
export type Offer = z.infer<typeof OfferSchema>;
export type OfferInput = z.input<typeof OfferSchema>;

/**
 * Every offer Channel3 listed for one product id at one moment. A decision always points at the
 * exact snapshot it was made from; the benchmark replays stored snapshots instead of live calls.
 */
export const OfferSnapshotSchema = z.object({
  id: uuidSchema<"SnapshotId">(),
  productId: z.string().min(1),
  title: z.string(),
  /** The variant this product id represents (Channel3 `variants.selected`). */
  selectedOptions: z.array(SelectedOptionSchema),
  offers: z.array(OfferSchema),
  /** Hash of the raw Channel3 response, for audit and replay. */
  rawHash: z.string().min(1),
  fetchedAt: z.coerce.date(),
});
export type OfferSnapshot = z.infer<typeof OfferSnapshotSchema>;
export type OfferSnapshotInput = z.input<typeof OfferSnapshotSchema>;
