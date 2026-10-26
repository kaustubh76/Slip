import {
  type ClassifierAnswer,
  DEFAULT_POLICY,
  type Decision,
  type OfferSnapshot,
  type Policy,
  type SelectedOption,
} from "@slip/domain";
import { NOW, request } from "@slip/domain/testing";
import { decide } from "../decide.js";
import { type Prepared, prepareCheck } from "../prepare.js";

export {
  minutesFromNow,
  NOW,
  type OfferSpec,
  offer,
  request,
  type SnapshotSpec,
  snapshot,
  testUuid,
} from "@slip/domain/testing";

export interface RunSpec {
  snapshot: OfferSnapshot | null;
  chosen: string;
  selected?: SelectedOption[];
  policy?: Policy;
  now?: Date;
  /** Defaults to a clean listing, which is what the classifier says on the normal path. */
  classifier?: ClassifierAnswer;
  /** What the orchestrator showed the classifier beside the listing, kept on the result (D87). */
  searchContext?: string | null;
}

/** `prepareCheck` then `decide`, the way the orchestrator will call them. */
export function runCheck(spec: RunSpec): Decision {
  const policy = spec.policy ?? DEFAULT_POLICY;
  const prepared: Prepared = prepareCheck({
    snapshot: spec.snapshot,
    request: request({
      url: spec.chosen,
      ...(spec.selected === undefined ? {} : { selected: spec.selected }),
    }),
    policy,
    now: spec.now ?? NOW,
  });
  if (prepared.kind !== "ready") {
    return prepared.decision;
  }
  return decide(
    prepared,
    policy,
    spec.classifier ?? { instruction_like: false },
    spec.searchContext ?? null,
  );
}
