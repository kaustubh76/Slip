import type { ReceiptView } from "@slip/receipt";
import { type LinkLike, PlainLink } from "./Link.js";
import { stampOf } from "./ReceiptSlip.js";
import { Stamp } from "./Stamp.js";
import { StatusLine } from "./StatusLine.js";
import { clockTime, withAmounts } from "./text.js";

/** A receipt in the roll, with the agent that made it. */
export interface RollEntry {
  view: ReceiptView;
  agent: { id: string; name: string };
}

/** One printed line of the roll: time, agent, what was tried, the verdict, the money. */
export function RollRow(props: {
  entry: RollEntry;
  href: string;
  Link?: LinkLike;
  /** It just printed: the row opens and its stamp presses. */
  fresh?: boolean;
  /**
   * The day this row opens, when it is the first of one. It is written inside the row rather than
   * between rows, so the roll stays a list of receipts and nothing else.
   */
  day?: string;
}) {
  const { view, agent } = props.entry;
  const Link = props.Link ?? PlainLink;
  const stamp = stampOf(view);
  const waiting = view.hold?.status === "PENDING";
  return (
    <li
      className={props.fresh ? "slip-row slip-print" : "slip-row"}
      data-cocked={waiting ? "" : undefined}
      data-slip-outcome={view.outcome}
    >
      {props.day === undefined ? null : <p className="slip-day">{props.day}</p>}
      <time className="slip-mono" dateTime={view.createdAt}>
        {clockTime(view.createdAt)}
      </time>
      <div>
        <p className="slip-meta">{agent.name}</p>
        <p>
          <Link href={props.href} className="slip-link">
            {withAmounts(view.opening[0] ?? view.verdict)}
          </Link>{" "}
          {view.opening[0] === undefined ? null : withAmounts(view.verdict)}
        </p>
        <StatusLine state={view.state} />
      </div>
      <Stamp kind={stamp.kind} label={stamp.label} pressed={props.fresh === true} />
    </li>
  );
}

/**
 * The till roll: receipts newest first. New ones never push the page while the owner reads below
 * the top: they wait behind a pen-blue pill until asked for.
 */
export function Roll(props: {
  entries: readonly RollEntry[];
  hrefFor: (entry: RollEntry) => string;
  Link?: LinkLike;
  /** Receipts printed since the owner scrolled away from the top. */
  newAbove?: number;
  onRevealNew?: () => void;
  hasOlder?: boolean;
  onOlder?: () => void;
  /** Where the older page is, for a server-rendered roll with no handlers. */
  olderHref?: string;
  /** Receipt ids that just printed, to animate. */
  fresh?: ReadonlySet<string>;
  /**
   * Where the day changes, by the id of the first receipt of each day (see `dayStarts`). The
   * separator is marked as presentation, so the roll still counts one item per receipt.
   */
  days?: ReadonlyMap<string, string>;
}) {
  const Link = props.Link ?? PlainLink;
  const newAbove = props.newAbove ?? 0;
  return (
    <section aria-label="Receipts">
      {newAbove > 0 ? (
        <button type="button" className="slip-pill" onClick={props.onRevealNew}>
          {newAbove} new {newAbove === 1 ? "receipt" : "receipts"} printed above
        </button>
      ) : null}
      {props.entries.length === 0 ? (
        <div className="slip-sheet" data-perforated="">
          <p className="slip-sentence">
            No receipts yet. The first one prints here the moment an agent calls checkout.
          </p>
        </div>
      ) : (
        <ol className="slip-roll">
          {props.entries.map((entry) => {
            const day = props.days?.get(entry.view.receiptId);
            return (
              <RollRow
                key={entry.view.receiptId}
                entry={entry}
                href={props.hrefFor(entry)}
                fresh={props.fresh?.has(entry.view.receiptId) ?? false}
                {...(day === undefined ? {} : { day })}
                {...(props.Link === undefined ? {} : { Link: props.Link })}
              />
            );
          })}
        </ol>
      )}
      {props.hasOlder ? (
        <p>
          {props.olderHref === undefined ? (
            <button type="button" className="slip-button" onClick={props.onOlder}>
              Older receipts →
            </button>
          ) : (
            <Link href={props.olderHref} className="slip-button">
              Older receipts →
            </Link>
          )}
        </p>
      ) : null}
    </section>
  );
}
