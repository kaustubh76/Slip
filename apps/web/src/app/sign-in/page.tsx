import { redirect } from "next/navigation";
import { demoRefused, isDemo } from "../../server/demo";
import { currentOwner } from "../../server/owner";
import { signInToDemo } from "../actions/session";

export const dynamic = "force-dynamic";

export default async function SignIn() {
  if ((await currentOwner()) !== null) {
    redirect("/receipts");
  }
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
        </form>
      ) : (
        <p className="slip-note slip-pen">
          {demoRefused()
            ? "The demo needs one long-lived server: its stand-in for PayPal keeps everything in memory, which a serverless deployment would split across instances."
            : "Signing in needs a PayPal sandbox. Start the server with SLIP_DEMO=1 to try Slip against a stand-in for PayPal instead."}
        </p>
      )}
    </article>
  );
}
