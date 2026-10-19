import { redirect } from "next/navigation";
import { demoRefused, isDemo } from "../../server/demo";
import { currentOwner } from "../../server/owner";
import { SERVICES } from "../../server/runtime";
import { signInToDemo, signInWithPassword, startWithPayPal } from "../actions/session";

export const dynamic = "force-dynamic";

const REFUSALS: Record<string, string> = {
  full: "This server has opened as many desks as it can hold. Restart it, or try again later.",
  slow: "That is a lot of desks from one place in a few minutes. Wait a little, then open another.",
  live: "While PayPal is live, starting needs an email and a password: without one there is no way back in if the browser forgets you.",
  credential:
    "That email and password do not match an owner — or the address is already in use, or the password is under 12 characters.",
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
      ) : (
        <form action={startWithPayPal}>
          <p className="slip-prose">
            {SERVICES.payment === "live"
              ? "Slip opens your permission and sends you to PayPal to approve saving a payment method. Real money moves when your agent buys."
              : START[SERVICES.payment]}
          </p>
          <div className="slip-fields">
            <div className="slip-field">
              <label htmlFor="start-email" className="slip-field-label">
                Email
              </label>
              <input
                id="start-email"
                name="email"
                className="slip-blank"
                type="email"
                autoComplete="username"
                required={SERVICES.payment === "live"}
              />
              <p className="slip-caption">
                {SERVICES.payment === "live"
                  ? "Needed while PayPal is live: your browser carries this session, and this is the only way back in if it forgets."
                  : "Optional. Your browser carries this session; an email and password are the only way back in if it forgets."}
              </p>
            </div>
            <div className="slip-field">
              <label htmlFor="start-password" className="slip-field-label">
                Password
              </label>
              <input
                id="start-password"
                name="password"
                className="slip-blank"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required={SERVICES.payment === "live"}
              />
              <p className="slip-caption">
                At least 12 characters. Slip cannot send email, so a forgotten password cannot be
                reset — keep it somewhere.
              </p>
            </div>
          </div>
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
      {isDemo() || demoRefused() ? null : (
        <form action={signInWithPassword}>
          <hr className="slip-rule" />
          <p className="slip-meta">Been here before?</p>
          <p className="slip-caption">
            Sign in with the email and password you started with. This is the same session your
            browser would have carried.
          </p>
          <div className="slip-fields">
            <div className="slip-field">
              <label htmlFor="return-email" className="slip-field-label">
                Email
              </label>
              <input
                id="return-email"
                name="email"
                className="slip-blank"
                type="email"
                autoComplete="username"
                required
              />
            </div>
            <div className="slip-field">
              <label htmlFor="return-password" className="slip-field-label">
                Password
              </label>
              <input
                id="return-password"
                name="password"
                className="slip-blank"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
          </div>
          <button type="submit" className="slip-button">
            Sign in →
          </button>
        </form>
      )}
    </article>
  );
}
