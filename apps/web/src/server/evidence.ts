import "server-only";
import bench from "../../../../bench/results/slipbench.json";
import judge from "../../../../bench/results/steering-judge.json";
import study from "../../../../study/results/market-study.json";

/**
 * The measured evidence, read from the files the study and the benchmark write.
 *
 * Imported rather than read at runtime so the numbers are fixed into the build — a page that ran
 * `fs.readFile` would work in development and find nothing on a serverless deployment where only
 * the bundle ships. Both files are committed, and both are regenerated from their snapshots with
 * `pnpm study:report` and `pnpm bench:report`, so nothing here can drift from what was measured.
 *
 * The benchmark's file exists with `ranAt: null` until it has run. That is what the page reads to
 * decide whether to show results or say plainly that there are none yet. The steering sweep's file
 * is written only by `pnpm bench:judge`, and is committed for the same reason the others are: a
 * static import so the numbers are in the bundle, which a serverless deployment is all that ships.
 */

export interface StudyEvidence {
  sampledAt: string;
  credits: number;
  queries: { slug: string; query: string; products: number }[];
  numbers: {
    products: number;
    priced: number;
    withTwoOrMore: number;
    shareWithTwoOrMorePctHundredths: number;
    g1Pass: boolean;
    medianGapPctHundredths: number | null;
    medianGapCents: number | null;
    medianGapPctHundredthsExcludingSuspect: number | null;
    suspectGrouping: number;
    quartileGapPctHundredths: { lower: number | null; upper: number | null };
    commissionConsidered: number;
    commissionConflicts: number;
    commissionConflictPctHundredths: number | null;
    offersListed: number;
    offersMapped: number;
    offersComparable: number;
  };
}

export interface BenchEvidence {
  ranAt: string | null;
  errands: number;
  tallies: {
    agent: string;
    condition: string;
    errands: number;
    overpaid: number;
    medianOverpaidPctHundredths: number | null;
    tookThePlantedOffer: number;
    paidWithSlipOn: number;
    stoppedBySlip: number;
  }[];
}

/** One arm of the steering sweep: the planted text, or the honest description on its own. */
export interface JudgeArm {
  arm: string;
  asked: number;
  flagged: number;
  clear: number;
  noAnswer: number;
  /** Unanswered *fast*, which is what a rate limit looks like rather than a slow model. */
  noAnswerFast: number;
  slowestMs: number;
}

export interface JudgeEvidence {
  ranAt: string | null;
  model: string;
  promptVersion: string;
  deadlineMs: number;
  inputTokens: number;
  tally: { honest: JudgeArm; buried: JudgeArm };
}

export const STUDY: StudyEvidence = study as StudyEvidence;
export const BENCH: BenchEvidence = bench as BenchEvidence;
export const JUDGE: JudgeEvidence = judge as JudgeEvidence;
