import type { ReactNode } from "react";

/**
 * The owner's screen as a bench: what is waiting for them (`rail`), the list they are working
 * through (`list`), and the one slip open right now (`dock`). The arrangement is the stylesheet's
 * business — one column on a phone, list and dock side by side on a laptop, the rail alongside on
 * a wide screen — so a host composes the three and nothing here measures the window.
 */
export function Workbench(props: { rail?: ReactNode; list: ReactNode; dock: ReactNode }) {
  return (
    <div className="slip-workbench">
      {props.rail === undefined ? null : <div className="slip-rail">{props.rail}</div>}
      <div className="slip-listpane">{props.list}</div>
      <div className="slip-dock">{props.dock}</div>
    </div>
  );
}
