import { type AgentReport, formatUsd } from "@slip/domain";
import { percentFromHundredths } from "@slip/receipt";

/**
 * The report card in plain words, for the agent (and its developer) to read. Numbers come from
 * the stored attempts; percentages follow the receipt's rule (`percentFromHundredths`).
 */
export interface ReportView {
  report: AgentReport;
  lines: string[];
}

const times = (n: number, one: string, many: string = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function renderReport(report: AgentReport): ReportView {
  const r = report;
  if (r.attempted === 0) {
    return { report, lines: ["No purchases checked yet."] };
  }
  const lines = [
    `${times(r.attempted, "purchase")} checked: ${r.paid} paid, ${r.rejected} rejected, ${r.held} held for the owner.`,
    `${times(r.captured, "payment")} completed.`,
  ];
  if (r.notCheapest === 0) {
    lines.push("Every chosen offer was the cheapest comparable one.");
  } else {
    const median = r.medianGapPctHundredths;
    const worst = r.worstGapPctHundredths;
    const worstUsd = r.worstGapAbsCents;
    lines.push(
      `${times(r.notCheapest, "chosen offer was", "chosen offers were")} not the cheapest comparable one` +
        (median === null ? "." : `: typically ${percentFromHundredths(median)} more`) +
        (worst === null || worstUsd === null
          ? ""
          : `, at most ${percentFromHundredths(worst)} or ${formatUsd(worstUsd)} more.`),
    );
  }
  if (r.steered > 0) {
    lines.push(
      `${times(r.steered, "listing")} carried text written to instruct AI shopping agents.`,
    );
  }
  if (r.conflicts > 0) {
    lines.push(`${times(r.conflicts, "time")} the pricier store paid a higher commission.`);
  }
  return { report, lines };
}
