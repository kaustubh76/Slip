import { type ReceiptView, shortNo } from "@slip/receipt";
import type { ReactNode } from "react";
import { GapScale } from "./GapScale.js";
import { Stamp, type StampKind } from "./Stamp.js";
import { StatusLine } from "./StatusLine.js";
import { printedAt, withAmounts } from "./text.js";

/** The stamp a receipt carries: its verdict, or grey once its hold was let go. */
export function stampOf(view: ReceiptView): { kind: StampKind; label: string } {
  const hold = view.hold?.status;
  if (hold === "EXPIRED") {
    return { kind: "VOID", label: "EXPIRED" };
  }
  if (hold === "DECLINED") {
    return { kind: "VOID", label: view.hold?.decidedBy === "system" ? "RELEASED" : "DECLINED" };
  }
  return { kind: view.outcome, label: view.outcome };
}

/**
 * One receipt, as a slip: the five-second part (what the agent tried, against the lowest listed
 * price, and the verdict, stamped), the gap scale, where the money stands, and the owner's
 * controls (`children`). What is behind the receipt goes below the tear line (`behind`).
 * Renders a receipt view only — never a domain record — so a platform can embed it.
 */
export function ReceiptSlip(props: {
  view: ReceiptView;
  agentName?: string;
  /** The stamp presses as the slip appears (it just printed). */
  fresh?: boolean;
  children?: ReactNode;
  behind?: ReactNode;
}) {
  const { view } = props;
  const stamp = stampOf(view);
  const headingId = `slip-${view.receiptId}`;
  const cheaper = view.gap !== null && view.best !== null ? view.best : null;
  return (
    <article
      className="slip-sheet slip-receipt"
      data-perforated=""
      aria-labelledby={headingId}
      data-slip-outcome={view.outcome}
      data-slip-rule={view.ruleCode}
      data-slip-payment={view.state.word}
      data-slip-hold={view.hold?.status ?? "NONE"}
    >
      <header className="slip-receipt-head">
        <h2 id={headingId} className="slip-meta">
          {view.hold === null ? "Slip" : "Hold"} · receipt no. {shortNo(view.receiptId)}
        </h2>
        <p className="slip-meta">
          <time dateTime={view.createdAt}>{printedAt(view.createdAt)}</time>
        </p>
        {props.agentName === undefined ? null : (
          <p className="slip-meta">agent {props.agentName}</p>
        )}
      </header>
      <hr className="slip-rule" />
      <div className="slip-receipt-body">
        <div className="slip-receipt-words">
          {[...view.opening, view.verdict].map((line) => (
            <p key={line} className="slip-sentence">
              {withAmounts(line)}
            </p>
          ))}
        </div>
        <Stamp
          kind={stamp.kind}
          label={stamp.label}
          size="large"
          rotated
          pressed={props.fresh === true}
        />
      </div>
      {view.measure === null ? null : <GapScale measure={view.measure} />}
      <p className="slip-caption">{view.footer}</p>
      {cheaper === null ? null : (
        <p>
          <a className="slip-link" href={cheaper.url} rel="noopener noreferrer" target="_blank">
            Open the {cheaper.price} offer at {cheaper.store} →
          </a>
        </p>
      )}
      <StatusLine state={view.state} />
      {props.children}
      {props.behind === undefined ? null : (
        <>
          <hr className="slip-tear" />
          {props.behind}
        </>
      )}
    </article>
  );
}
