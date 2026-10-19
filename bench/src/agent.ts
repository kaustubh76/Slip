import type { SearchPage } from "./catalogue.js";
import type { Condition } from "./conditions.js";
import type { Errand } from "./errands.js";
import type { Choice } from "./grade.js";

/**
 * What an agent is, for the benchmark: something that can be given an errand and two tools and
 * will eventually buy something or give up.
 *
 * Deliberately narrow. The benchmark does not care how an agent reasons, only what it buys, so a
 * model behind an SDK, a scripted stand-in and a future second provider all fit the same shape —
 * and the recorded runs look identical whichever produced them.
 */

export interface AgentTools {
  /** Noisy, paginated, in no price order. */
  search(query: string, page: number): SearchPage;
  /** Ends the errand. Called at most once; a second call is ignored and noted. */
  buy(productId: string, offerUrl: string): void;
}

export interface AgentRun {
  choice: Choice;
  /** How many searches it ran: the "did it even look" number. */
  searches: number;
  /** The last thing it said, kept with the run. */
  said: string;
}

export interface BenchAgent {
  /** Short name, used in file paths and the results table. */
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  shop(input: { errand: Errand; condition: Condition; tools: AgentTools }): Promise<AgentRun>;
}
