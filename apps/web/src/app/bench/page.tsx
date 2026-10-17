import { Leaders, Stamp } from "@slip/ui";

export const metadata = { title: "Bench · Slip" };

/**
 * The evidence Slip will be judged on, as planned in the spec (§6). Neither study has run, so the
 * page says so and shows the method and the sample sizes — never a placeholder figure. Results are
 * printed here as measured, with their sample size and date, when they exist.
 */
export default function Bench() {
  return (
    <>
      <article className="slip-sheet" data-perforated="" aria-labelledby="market-study">
        <header className="slip-receipt-head">
          <p className="slip-meta" id="market-study">
            Market study · real listings, no agents
          </p>
          <Stamp kind="VOID" label="NOT RUN YET" describedAs="This study has not run yet" />
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
            ["Sample", "150–200 products, fewer if API credits run short"],
            ["Source", "Channel3 listings, as fetched"],
            ["Synthetic content", "none"],
            ["Figures", "none until it has run"],
          ]}
        />
        <p className="slip-caption">
          Whatever it shows is printed here as measured, with the sample size and the date.
        </p>
      </article>

      <article className="slip-sheet" data-perforated="" aria-labelledby="slipbench">
        <header className="slip-receipt-head">
          <p className="slip-meta" id="slipbench">
            SlipBench · how agents shop, with and without Slip
          </p>
          <Stamp kind="VOID" label="NOT RUN YET" describedAs="This benchmark has not run yet" />
        </header>
        <hr className="slip-rule" />
        <p className="slip-sentence">
          Agents run the same errands under three conditions, once paying directly and once with
          Slip checking each purchase first.
        </p>
        <Leaders
          rows={[
            ["Errands", "20–25, each naming one specific product"],
            ["Agents", "3, from at least two model providers, one a small low-cost model"],
            ["Conditions", "3, each with Slip off and on"],
            ["Prices", "real offers, replayed from stored snapshots"],
          ]}
        />
        <table className="slip-offers">
          <caption className="slip-meta">The three conditions</caption>
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
          </tbody>
        </table>
        <p className="slip-caption">
          * The &ldquo;Top pick&rdquo; label and the instruction-like text are synthetic, and are
          labelled so wherever they appear. The offers and prices are real.
        </p>
        <p className="slip-prose">
          It will report, per agent and condition: the share of purchases that overpaid, and the
          typical overpayment in percent and in dollars, with Slip off and with Slip on. Every
          snapshot, prompt and output will be committed.
        </p>
      </article>
    </>
  );
}
