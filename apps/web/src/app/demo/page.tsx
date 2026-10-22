import { shortNo, utcDay } from "@slip/receipt";
import { notFound } from "next/navigation";
import { DemoConsole } from "../../components/DemoConsole";
import { isDemo } from "../../server/demo";
import { ERRAND_NAMES, ERRANDS } from "../../server/demo/catalogue";
import { requireOwner } from "../../server/owner";
import { fakes, runtime } from "../../server/runtime";

export const dynamic = "force-dynamic";

/** The demo console: this desk's agent and its stand-in PayPal, on demand. Demo mode only. */
export default async function Demo() {
  if (!isDemo()) {
    notFound();
  }
  const { mandateId } = await requireOwner();
  const { deps } = await runtime();
  const stand = await fakes();
  // A desk is seeded with two days of history behind it, so the log spans days — and a column of
  // bare times then reads as though 20:00:00 came after 17:45:15. Today's rows keep the time alone,
  // which is what someone pressing a button is watching for; older ones carry their date.
  const today = utcDay(deps.clock.now());
  const calls = stand.gateway.callsFor(mandateId).map((c) => {
    const day = utcDay(new Date(c.at));
    return {
      at: c.at,
      when: day === today ? c.at.slice(11, 19) : `${day.slice(0, 6)} ${c.at.slice(11, 19)}`,
      call: c.call,
      receipt: c.attemptId === null ? null : shortNo(c.attemptId),
      detail: c.detail,
      answer: c.answer,
    };
  });
  return (
    <DemoConsole
      errands={ERRAND_NAMES.map((name) => ({ name, label: ERRANDS[name].label }))}
      calls={calls}
      base={deps.config.publicBaseUrl}
    />
  );
}
