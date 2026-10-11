/**
 * Nominal typing helper. `Branded<number, "Cents">` is a number the compiler will not confuse
 * with a plain number or with another brand. Construct values through the validating functions
 * next to each brand; never cast in application code.
 */
export type Branded<T, Brand extends string> = T & { readonly __brand: Brand };
