import type { ClassifierInput, ClassifierVerdict, SteeringClassifier } from "@slip/domain";

/** What the next call answers instead of the rules. `hang` waits until the caller aborts. */
export type ScriptedAnswer = { instruction_like: boolean } | "NO_ANSWER" | "hang";

/**
 * A scripted steering classifier. By default nothing is instruction-like; `flagWhenListingIncludes`
 * marks a listing *or* a search context containing a phrase (case-insensitive), as the
 * injected-text benchmark condition does. Answers for the next calls can be forced, including NO_ANSWER and a hang that ends as
 * NO_ANSWER when the caller's deadline aborts. Every call is logged.
 */
export class FakeSteeringClassifier implements SteeringClassifier {
  readonly calls: ClassifierInput[] = [];
  readonly model = "fake-steering";
  readonly promptVersion = "fake-1";
  readonly #phrases: string[] = [];
  readonly #next: ScriptedAnswer[] = [];

  flagWhenListingIncludes(phrase: string): void {
    this.#phrases.push(phrase.toLowerCase());
  }

  answerNext(...answers: ScriptedAnswer[]): void {
    this.#next.push(...answers);
  }

  async classify(input: ClassifierInput, signal: AbortSignal): Promise<ClassifierVerdict> {
    this.calls.push(structuredClone(input));
    const verdict = (answer: ClassifierVerdict["answer"]): ClassifierVerdict => ({
      answer,
      model: this.model,
      promptVersion: this.promptVersion,
    });
    if (signal.aborted) {
      return verdict("NO_ANSWER");
    }
    const scripted = this.#next.shift();
    if (scripted === "hang") {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return verdict("NO_ANSWER");
    }
    if (scripted !== undefined) {
      return verdict(scripted);
    }
    // Both texts, because on real data the listing is empty and the search context is where an
    // injection would be (D67). A fake that read only the listing could never flag the real path.
    const text = `${input.listingText}\n${input.searchContext ?? ""}`.toLowerCase();
    return verdict({ instruction_like: this.#phrases.some((phrase) => text.includes(phrase)) });
  }
}
