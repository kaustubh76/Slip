import type { Attempt } from "./attempt.js";
import type { Hold } from "./hold.js";
import type { Payment } from "./payment.js";

/**
 * What the owner and the agent are shown for one attempt: the immutable decision plus the live
 * state of its payment and hold. The receipt id is the attempt id (D15). The plain-language
 * sentence is not stored; it is rendered by code from these fields, so its numbers can never
 * disagree with them (D16).
 */
export interface Receipt {
  attempt: Attempt;
  payment: Payment | null;
  hold: Hold | null;
}
