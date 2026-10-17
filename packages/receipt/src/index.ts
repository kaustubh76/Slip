export { shortNo, utcDateTime, utcDayTime, utcTime } from "./format.js";
export { MEASURE_WIDTH, measureModel } from "./measure.js";
export { gapPercent, percentFromHundredths } from "./percent.js";
export {
  APPROVAL_HINTS,
  type Measure,
  MeasureSchema,
  type OfferSummary,
  OfferSummarySchema,
  type ReceiptView,
  ReceiptViewSchema,
  StateLineSchema,
} from "./schema.js";
export { footer, openingLines, type PricesSource, ruleSentence, verdict } from "./sentences.js";
export { type StateContext, type StateGlyph, type StateLine, stateLine } from "./state.js";
export { storeName } from "./store-name.js";
export { type RenderOptions, renderReceipt } from "./view.js";
