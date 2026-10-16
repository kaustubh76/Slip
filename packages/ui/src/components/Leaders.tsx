import type { ReactNode } from "react";

/** Label ........ value lines; the description list underneath is what assistive tech reads. */
export function Leaders({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="slip-leaders">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
