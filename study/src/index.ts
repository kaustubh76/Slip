export {
  G1_SHARE_PCT_HUNDREDTHS,
  mapAsSlipWould,
  measureOne,
  measureProducts,
  type ProductMeasure,
  productsFrom,
  type Spread,
  type StudyNumbers,
  summarise,
} from "./measure.js";
export { RESULTS_PER_QUERY, SAMPLE_CREDITS, SAMPLE_QUERIES, type SampleQuery } from "./queries.js";
export { renderReport } from "./report.js";
export { runSample, type SampleReport } from "./sample.js";
export {
  hashOf,
  isIntact,
  type Manifest,
  readManifest,
  readSnapshots,
  SNAPSHOT_DIR,
  type Snapshot,
  writeManifest,
  writeSnapshot,
} from "./snapshots.js";
export {
  AGENT_DIRECTED_PATTERNS,
  JUDGED,
  type JudgedCandidate,
  scanText,
  type TextCandidate,
  type TextPattern,
  type TextScan,
  verdictFor,
} from "./text.js";
