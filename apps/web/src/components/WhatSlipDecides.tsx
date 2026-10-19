import { Stamp } from "@slip/ui";
import Link from "next/link";

/**
 * The three answers Slip can give, in its own stamps. A legend, not a receipt: no purchase, store
 * or price is invented here, because the front door is the one page with no data behind it and a
 * made-up slip would be the one thing Slip tells agents not to do.
 */
export function WhatSlipDecides() {
  return (
    <article className="slip-sheet">
      <p className="slip-meta">What Slip answers</p>
      <dl className="slip-legend">
        <div>
          <dt>
            <Stamp kind="PAID" describedAs="Outcome: paid" />
          </dt>
          <dd className="slip-prose">
            The offer is the lowest listed, or close enough to it. Slip pays, and prints a receipt
            saying what it compared.
          </dd>
        </div>
        <div>
          <dt>
            <Stamp kind="REJECTED" describedAs="Outcome: rejected" />
          </dt>
          <dd className="slip-prose">
            The same item was listed for less, by more than you allow. Nothing is charged, and the
            cheaper listing is on the receipt.
          </dd>
        </div>
        <div>
          <dt>
            <Stamp kind="HELD" describedAs="Outcome: held" />
          </dt>
          <dd className="slip-prose">
            Over your cap, or something Slip could not check. It waits 48 hours for you to decide,
            and releases itself if you do not.
          </dd>
        </div>
      </dl>
      <hr className="slip-rule" />
      <p className="slip-prose">
        Rules are code; no AI model decides an outcome.{" "}
        <Link href="/bench" className="slip-link">
          What Slip measured on real listings →
        </Link>
      </p>
    </article>
  );
}
