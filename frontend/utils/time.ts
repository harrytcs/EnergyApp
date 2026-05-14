/** Format a unix timestamp as "1:23 PM" */
export function fmtTime(ts: number | null | undefined): string | null {
  if (!ts) return null;
  return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Format hours-from-now as "2h 15m · done by 5:30 PM" */
export function fmtETA(hoursFromNow: number): string {
  if (hoursFromNow <= 0) return 'almost done';
  const eta = new Date(Date.now() + hoursFromNow * 3600 * 1000);
  const timeStr = eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const h = Math.floor(hoursFromNow);
  const m = Math.round((hoursFromNow - h) * 60);
  const dur = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  return `${dur} · done by ${timeStr}`;
}
