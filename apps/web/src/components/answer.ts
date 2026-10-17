/**
 * A server action's answer, or `unknown` when none arrived: the network dropped, or the server
 * restarted mid-call. The call may still have done its work — moved money, revoked a key — so the
 * caller must treat it as "Slip is checking", re-read, and never send it again on its own. Without
 * this, a lost answer left the dialog busy for good, with Cancel and Esc disabled.
 */
export function answerOf<T>(call: Promise<T>): Promise<T | { status: "unknown" }> {
  return call.catch(() => ({ status: "unknown" as const }));
}
