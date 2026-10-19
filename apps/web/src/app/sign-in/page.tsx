import { redirect } from "next/navigation";
import { demoRefused, isDemo } from "../../server/demo";
import { currentOwner } from "../../server/owner";
import { SERVICES } from "../../server/runtime";
import { signInToDemo, startWithPayPal } from "../actions/session";

export const dynamic = "force-dynamic";

const REFUSALS: Record<string, string> = {
  full: "This server has opened as many desks as it can hold. Restart it, or try again later.",
  slow: "That is a lot of desks from one place in a few minutes. Wait a little, then open another.",
  live: "Starting here is closed while PayPal is live: there is no way back in yet if the browser forgets you.",
  foreign_host:
    "Open Slip at its own address to start; this one only carries PayPal's notifications.",
  paypal_unavailable: "PayPal could not start the approval just now. Try again shortly.",
};

/** What starting outside the demo involves, by where the payment really goes. */
const START: Record<"sandbox" | "simulated", string> = {
  sandbox:
    "Slip opens your permission and sends you to PayPal's sandbox to approve saving a payment method, with a sandbox buyer account. No real money moves.",
  simulated:
    "Slip opens your permission and sends you to a stand-in for PayPal's approval page, running in this server. No real money moves.",
};

export default async function SignIn(props: { searchParams: Promise<{ refused?: string }> }) {
  if ((await currentOwner()) !== null) {
    redirect("/receipts");
  }
  const refused = REFUSALS[(await props.searchParams).refused ?? ""];
  return (
    <article className="slip-sheet" data-perforated="">
      <p className="slip-meta">Slip</p>
      <h1 className="slip-title">Every purchase your agent tries, checked first</h1>
      <p className="slip-prose">
        Slip compares the offer your agent chose with every other offer listed for the same item,
        then pays, rejects, or holds the purchase for you — before PayPal moves any money.
      </p>
      {isDemo() ? (
        <form action={signInToDemo}>
          <p className="slip-prose">
            This demo gives you your own owner, a PayPal mandate approved against a stand-in for
            PayPal, one agent, and four purchases it has already tried.
          </p>
          <button type="submit" className="slip-button" data-variant="ink">
            Open a demo desk →
          </button>
          {refused === undefined ? null : (
            <p className="slip-note slip-pen" role="status">
              {refused}
            </p>
          )}
        </form>
      ) : demoRefused() ? (
        <p className="slip-note slip-pen">
          The demo needs one long-lived server: its stand-in for PayPal keeps everything in memory,
          which a serverless deployment would split across instances.
        </p>
      ) : SERVICES.payment === "live" ? (
        <p className="slip-note slip-pen">{REFUSALS["live"]}</p>
      ) : (
        <form action={startWithPayPal}>
          <p className="slip-prose">{START[SERVICES.payment]}</p>
          <button type="submit" className="slip-button" data-variant="ink">
            Start with PayPal →
          </button>
          {refused === undefined ? null : (
            <p className="slip-note slip-pen" role="status">
              {refused}
            </p>
          )}
        </form>
      )}
    </article>
  );
}
