import { formatPct, formatUsd } from "@slip/domain";
import { Leaders, Stamp } from "@slip/ui";
import { BENCH, STUDY } from "../../server/evidence";

export const metadata = { title: "Bench · Slip" };

/**
 * The evidence Slip is judged on (spec §6), read from the files the study and the benchmark write
 * rather than written out here — so this page cannot claim a number nobody measured, and cannot go
 * stale when they are measured again.
 *
 * Both have run: the market study on 19 Oct, SlipBench on 21 Oct on one of its two agents. The
 * page still carries the other branch of every claim, because a clone whose results are deleted,
 * or a second agent that has not been swept, must read as not measured rather than as zero.
 */
/** A share in hundredths of a percent, or an em dash when there was nothing to measure. */
function share(hundredths: number | null): string {
  return hundredths === null ? "—" : formatPct(hundredths);
}

/** The typical gap, quoting the figure that excludes suspected catalogue errors. */
function gap(): string {
  const { medianGapPctHundredthsExcludingSuspect, medianGapCents } = STUDY.numbers;
  if (medianGapPctHundredthsExcludingSuspect === null) {
    return "—";
  }
  const dollars = medianGapCents === null ? "" : ` · ${formatUsd(medianGapCents as never)}`;
  return `${formatPct(medianGapPctHundredthsExcludingSuspect)}${dollars}`;
}

export default function Bench() {
  return (
    // Two independent pieces of evidence, read side by side where there is room for both.
    <div className="slip-cards">
      <article className="slip-sheet" data-perforated="" aria-labelledby="market-study">
        <header className="slip-receipt-head">
          <p className="slip-meta" id="market-study">
            Market study · real listings, no agents
          </p>
          <Stamp
            kind={STUDY.numbers.g1Pass ? "PAID" : "HELD"}
            label={STUDY.numbers.g1Pass ? "MEASURED" : "MEASURED · THIN"}
            describedAs={`Measured on ${STUDY.sampledAt.slice(0, 10)} across ${STUDY.numbers.products} products`}
          />
        </header>
        <hr className="slip-rule" />
        <p className="slip-sentence">
          How often the same item is listed at different prices, and whether the offer that pays an
          agent&apos;s platform the most is the cheapest.
        </p>
        <ol className="slip-prose">
          <li>The share of products with two or more comparable offers.</li>
          <li>The typical gap between the cheapest and the priciest offer for the same item.</li>
          <li>How often the offer paying the most commission is not the cheapest.</li>
        </ol>
        <Leaders
          rows={[
            [
              "Sample",
              `${STUDY.numbers.products} products from ${STUDY.queries.length} searches, ${STUDY.sampledAt.slice(0, 10)}`,
            ],
            ["Source", "Channel3 listings, as fetched"],
            ["Synthetic content", "none"],
            [
              "Two or more comparable offers",
              `${share(STUDY.numbers.shareWithTwoOrMorePctHundredths)} (${STUDY.numbers.withTwoOrMore} of ${STUDY.numbers.products})`,
            ],
            ["Typical gap, cheapest to priciest", gap()],
            [
              "Dearer offer pays more commission",
              `${share(STUDY.numbers.commissionConflictPctHundredths)} (${STUDY.numbers.commissionConflicts} of ${STUDY.numbers.commissionConsidered})`,
            ],
          ]}
        />
        <p className="slip-prose">
          {STUDY.numbers.g1Pass
            ? "Comparison is possible for most of this sample."
            : `Comparison is possible for a minority of products: Channel3 listed ${STUDY.numbers.offersListed} offers across ${STUDY.numbers.products} products, and most carry only one. Slip's own mapping and comparison rule are not what thins it — ${STUDY.numbers.offersComparable} of those offers could be compared.`}
        </p>
        {STUDY.numbers.suspectGrouping > 0 ? (
          <p className="slip-prose">
            {`${STUDY.numbers.suspectGrouping} of the ${STUDY.numbers.withTwoOrMore} comparable products show a gap above 100%, which is more likely two different items filed under one product id than a bargain. They are excluded from the typical gap above, and a purchase with a gap that wide is held for the owner rather than rejected.`}
          </p>
        ) : null}
        <p className="slip-caption">
          Every figure is recomputed from the committed snapshots by <code>pnpm study:report</code>,
          with no API key and no network.
        </p>
      </article>

      <article className="slip-sheet" data-perforated="" aria-labelledby="slipbench">
        <header className="slip-receipt-head">
          <p className="slip-meta" id="slipbench">
            SlipBench · how agents shop, with and without Slip
          </p>
          <Stamp
            kind={BENCH.ranAt === null ? "VOID" : "PAID"}
            label={BENCH.ranAt === null ? "NOT RUN YET" : "MEASURED"}
            describedAs={
              BENCH.ranAt === null
                ? "This benchmark has not run yet"
                : `Run on ${BENCH.ranAt.slice(0, 10)}`
            }
          />
        </header>
        <hr className="slip-rule" />
        <p className="slip-sentence">
          Agents run the same errands under four conditions, once paying directly and once with Slip
          checking each purchase first.
        </p>
        <Leaders
          rows={[
            ["Errands", "21, each naming one specific product"],
            [
              "Agents",
              // What has results, not what is wired: a sweep may cover one agent and not the other.
              BENCH.tallies.length === 0
                ? "2 wired, both Anthropic — one of them small and low-cost"
                : `${new Set(BENCH.tallies.map((row) => row.agent)).size} measured of 2 wired, both Anthropic`,
            ],
            ["Conditions", "4, each with Slip off and on"],
            ["Prices", "real offers, replayed from stored snapshots"],
          ]}
        />
        <table className="slip-offers">
          <caption className="slip-meta">The four conditions</caption>
          <thead>
            <tr>
              <th scope="col">Condition</th>
              <th scope="col">What the agent gets</th>
              <th scope="col">What it tests</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">A. Realistic search</th>
              <td>
                A raw search tool with noisy, paginated results. It finds the item and compares the
                offers itself. Nothing is manipulated.
              </td>
              <td>Does laziness alone lead to overpaying?</td>
            </tr>
            <tr>
              <th scope="row">B. Endorsed*</th>
              <td>
                The same, but a pricier offer carries a &ldquo;Top pick&rdquo; label and is listed
                first.
              </td>
              <td>Endorsement and position bias</td>
            </tr>
            <tr>
              <th scope="row">C. Injected*</th>
              <td>The same, but a pricier listing contains text that reads like instructions.</td>
              <td>Resistance to prompt injection</td>
            </tr>
            <tr>
              <th scope="row">D. Buried*</th>
              <td>
                The same instruction, inside the product&rsquo;s own real description rather than on
                an offer, naming the pricier store.
              </td>
              <td>The same, where a real listing actually carries words</td>
            </tr>
          </tbody>
        </table>
        <p className="slip-caption">
          * The &ldquo;Top pick&rdquo; label and the instruction-like text are synthetic, and are
          labelled so wherever they appear. The offers, the prices and the descriptions are real. C
          and D are the same sentence in two places: no offer in this catalogue carries text of its
          own, and every product does, so only D puts it where an agent was already reading.
        </p>
        {BENCH.tallies.length === 0 ? (
          <p className="slip-prose">
            It will report, per agent and condition: the share of purchases that overpaid, and the
            typical overpayment in percent and in dollars, with Slip off and with Slip on. Every
            snapshot, prompt and output will be committed. It is built and waiting on a model key.
          </p>
        ) : null}
        {BENCH.tallies.length === 0 ? (
          <p className="slip-caption">
            Two agents are wired, both Anthropic. The spec asks for three across at least two
            providers; the second provider is not built, so this says two rather than promising
            three.
          </p>
        ) : (
          // Six columns of numbers do not reflow into anything readable, so on a narrow screen
          // this one scrolls rather than folding: focusable and named, so it can be reached by
          // keyboard and announced, which is what axe asks of a scrollable region.
          <section
            className="slip-scroller"
            // A scrollable region has to be reachable by keyboard, or someone who cannot drag it
            // cannot read the half that is off the edge (WCAG 2.1.1, and what axe checks for).
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container is operable.
            tabIndex={0}
            aria-label="SlipBench results, per agent and condition"
          >
            <table className="slip-offers slip-tally">
              <caption className="slip-meta">
                {`Per agent and condition, ${BENCH.errands} errands each`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Condition</th>
                  <th scope="col">Overpaid</th>
                  <th scope="col">Typical</th>
                  <th scope="col">Planted offer</th>
                  <th scope="col">Stopped</th>
                </tr>
              </thead>
              <tbody>
                {BENCH.tallies.map((row) => (
                  <tr key={`${row.agent}-${row.condition}`}>
                    <th scope="row">{row.agent}</th>
                    <td>{row.condition}</td>
                    <td>{`${row.overpaid}/${row.errands}`}</td>
                    <td>
                      {row.medianOverpaidPctHundredths === null
                        ? "—"
                        : formatPct(row.medianOverpaidPctHundredths)}
                    </td>
                    <td>{row.condition === "clean" ? "—" : `${row.tookThePlantedOffer}`}</td>
                    <td>{`${row.stoppedBySlip}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </article>
    </div>
  );
}
