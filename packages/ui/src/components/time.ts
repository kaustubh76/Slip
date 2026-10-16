/**
 * How long a hold has left, for the owner at a glance. `now` comes from the client's clock (the
 * view carries no "now"), so the server and the browser never disagree while rendering.
 */
export function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) {
    return "expired";
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return "under a minute left";
  }
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `${minutes}m left` : `${hours}h ${minutes % 60}m left`;
}
