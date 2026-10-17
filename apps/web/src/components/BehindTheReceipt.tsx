import { type OfferRow, type ReceiptDetail, type ReceiptView, shortNo } from "@slip/receipt";
import { Leaders } from "@slip/ui";
import Link from "next/link";

/**
 * Everything behind the five-second receipt, below the tear line: which rules tripped and in what
 * order, the policy version it was decided under, every offer the snapshot listed and why each one
 * was or was not compared, what PayPal was told and answered, the agent's own words (quoted, and
 * labelled as something Slip does not act on), and the payment's moves.
 */
export function BehindTheReceipt({ detail }: { detail: ReceiptDetail }) {
  const { view } = detail;
  return (
    <section aria-label="Behind the receipt">
      <h3 className="slip-meta">Behind the receipt</h3>
      <Leaders
        rows={[
          ["Rule", view.ruleCode],
          ["Policy", `version ${view.policyVersion}`],
          ["Payment", paymentSummary(view)],
          ...(view.paypal?.orderId === null || view.paypal === null
            ? []
            : ([["PayPal order", view.paypal.orderId]] as const)),
          ...(view.paypal?.authorizationId == null
            ? []
            : ([["Authorization", view.paypal.authorizationId]] as const)),
          ...(view.paypal?.captureId == null
            ? []
            : ([["Capture", view.paypal.captureId]] as const)),
          ...(view.snapshotId === null
            ? []
            : ([["Prices", `Channel3 snapshot ${shortNo(view.snapshotId)}`]] as const)),
        ]}
      />
      {detail.offers.length === 0 ? null : (
        <OffersTable offers={detail.offers} simulated={view.simulated} />
      )}
      <h4 className="slip-meta">Rules that tripped</h4>
      <ol className="slip-rules">
        {view.reasons.map((reason, i) => (
          <li key={reason} className="slip-prose">
            <span className="slip-mono" aria-hidden="true">
              [x]{" "}
            </span>
            {reason}
            {i === 0 ? <span className="slip-caption"> — this one decided it</span> : null}
          </li>
        ))}
      </ol>
      <p className="slip-caption">Rules are code; no AI model decides an outcome.</p>
      <h4 className="slip-meta">What the agent said</h4>
      <blockquote className="slip-prose slip-quote">
        {view.agentReason === "" ? "Nothing." : `“${view.agentReason}”`}
      </blockquote>
      <p className="slip-caption">
        Written by the agent. Slip stores it and shows it to you; no rule reads it.
      </p>
      {detail.parent === null ? null : (
        <p className="slip-prose">
          You approved this purchase from hold no.{" "}
          <Link href={`/receipts/${detail.parent.receiptId}`} className="slip-link">
            {shortNo(detail.parent.receiptId)}
          </Link>
          .
        </p>
      )}
      {detail.followUp === null ? null : (
        <p className="slip-prose">
          Paid by follow-up receipt no.{" "}
          <Link href={`/receipts/${detail.followUp.receiptId}`} className="slip-link">
            {shortNo(detail.followUp.receiptId)}
          </Link>
          .
        </p>
      )}
      {detail.timeline.length === 0 ? null : (
        <>
          <h4 className="slip-meta">What PayPal did</h4>
          <ol className="slip-timeline slip-mono">
            {detail.timeline.map((step) => (
              <li key={`${step.at}-${step.to}`}>
                <time dateTime={step.at}>{step.at.slice(11, 16)} UTC</time> {step.from} → {step.to}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function paymentSummary(view: ReceiptView): string {
  return view.paymentStatus === "NONE" ? "no PayPal order" : view.paymentStatus;
}

/** Every offer the snapshot listed: the lowest, the chosen, and why any was left out. */
function OffersTable({ offers, simulated }: { offers: OfferRow[]; simulated: boolean }) {
  return (
    <>
      <h4 className="slip-meta">Offers Slip compared</h4>
      <table className="slip-offers">
        <thead>
          <tr>
            <th scope="col">Store</th>
            <th scope="col">Listed price</th>
            <th scope="col">Commission</th>
            <th scope="col">Compared</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((offer, i) => (
            <tr
              // A listing can appear twice; the position keeps the rows apart.
              key={`${offer.domain}-${i}`}
              data-best={offer.best ? "" : undefined}
              data-chosen={offer.chosen ? "" : undefined}
            >
              <th scope="row">
                {offer.link === null || simulated ? (
                  offer.store
                ) : (
                  <a
                    className="slip-link"
                    href={offer.link}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {offer.store}
                  </a>
                )}
                {offer.best ? <span className="slip-offer-role"> LOWEST</span> : null}
                {offer.chosen ? <span className="slip-offer-role"> CHOSEN</span> : null}
              </th>
              <td className="slip-mono">{offer.price ?? "—"}</td>
              <td>{offer.commission === null ? "—" : `up to ${offer.commission}`}</td>
              <td>{offer.compared ? "yes" : `no: ${offer.notCompared ?? "left out"}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="slip-caption">
        Listed item prices only; shipping and tax are not included.
        {simulated ? " These stores and prices are made up for the demo." : ""}
      </p>
    </>
  );
}
