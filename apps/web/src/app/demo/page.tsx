import { shortNo } from "@slip/receipt";
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
  const calls = stand.gateway.callsFor(mandateId).map((c) => ({
    at: c.at,
    call: c.call,
    receipt: c.attemptId === null ? null : shortNo(c.attemptId),
    detail: c.detail,
    answer: c.answer,
  }));
  return (
    <DemoConsole
      errands={ERRAND_NAMES.map((name) => ({ name, label: ERRANDS[name].label }))}
      calls={calls}
      base={deps.config.publicBaseUrl}
    />
  );
}
