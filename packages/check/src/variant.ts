import type { SelectedOption } from "@slip/domain";

function optionKey(option: SelectedOption): string {
  return `${option.name.trim().toLowerCase()}\u0000${option.label.trim().toLowerCase()}`;
}

/**
 * True when the agent's requested variant is the variant this snapshot represents. Omitted or
 * empty request options mean "no constraint". Otherwise the two sets of `{name, label}` pairs
 * must be equal, ignoring order, case and surrounding whitespace.
 */
export function variantMatches(
  requested: readonly SelectedOption[] | undefined,
  actual: readonly SelectedOption[],
): boolean {
  if (requested === undefined || requested.length === 0) {
    return true;
  }
  const wanted = new Set(requested.map(optionKey));
  const have = new Set(actual.map(optionKey));
  if (wanted.size !== have.size) {
    return false;
  }
  for (const key of wanted) {
    if (!have.has(key)) {
      return false;
    }
  }
  return true;
}
