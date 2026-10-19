import type { RuleCode } from "@slip/domain";
import { useId } from "react";
import { type LinkLike, PlainLink } from "./Link.js";
import type { RollEntry } from "./Roll.js";
import { clockTime } from "./text.js";
import { timeLeft } from "./time.js";

/** Why a purchase is waiting, in two or three words. */
const WHY: Partial<Record<RuleCode, string>> = {
  R1_STALE_SNAPSHOT: "no fresh prices",
  CHOSEN_UNVERIFIED: "unclear listing",
  R2_TOO_FEW_OFFERS: "nothing to compare",
  R4A_NO_CLASSIFIER_ANSWER: "steering check silent",
  R5_COMMISSION_CONFLICT: "commission conflict",
  R6_ABOVE_ORDER_CAP: "above cap",
};

/** "Waiting for you": holds the owner still has to decide, soonest to expire first. */
export function HoldsTray(props: {
  entries: readonly RollEntry[];
  hrefFor: (entry: RollEntry) => string;
  /** The client's clock, for the countdowns. */
  now: number;
  Link?: LinkLike;
  /** The receipt open beside the tray, if one is: its row is marked, as the roll's is. */
  openId?: string;
}) {
  const Link = props.Link ?? PlainLink;
  const n = props.entries.length;
  // Unique per tray, so two trays on one page (a host embedding the kit) never share a label.
  const title = useId();
  return (
    <section className="slip-tray" aria-labelledby={title}>
      <header className="slip-tray-head">
        <h2 id={title} className="slip-meta">
          Waiting for you
        </h2>
        <p className="slip-meta">
          {n} {n === 1 ? "hold" : "holds"}
        </p>
      </header>
      {n === 0 ? (
        <p className="slip-caption">
          Nothing in the tray. Held purchases appear here with 48 hours to decide.
        </p>
      ) : (
        <ul className="slip-roll">
          {props.entries.map((entry) => {
            const { view, agent } = entry;
            const open = view.receiptId === props.openId;
            return (
              <li
                key={view.receiptId}
                className="slip-tray-row slip-mono"
                data-open={open ? "" : undefined}
              >
                <time dateTime={view.createdAt}>{clockTime(view.createdAt)}</time>{" "}
                <span>{agent.name}</span>{" "}
                <span>
                  {view.chosen === null
                    ? "no price"
                    : `${view.chosen.price} at ${view.chosen.store}`}
                </span>{" "}
                <span className="slip-caption">{WHY[view.ruleCode] ?? "held"}</span>{" "}
                <span>{view.hold === null ? "" : timeLeft(view.hold.expiresAt, props.now)}</span>{" "}
                <Link
                  href={props.hrefFor(entry)}
                  className="slip-link"
                  {...(open ? { "aria-current": "page" as const } : {})}
                >
                  Decide →
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
