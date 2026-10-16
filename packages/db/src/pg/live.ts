import type { ChangeStamp, LiveRepo } from "@slip/domain";
import { sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { guarded } from "./errors.js";
import { rowsOf } from "./rows.js";

/**
 * How much has happened under one mandate, in one statement: a few counting subqueries, each over
 * an indexed column. The owner's pages ask for it about once a second and only re-read what they
 * show when a number has moved, so it has to be cheap and it must never miss a write.
 *
 * Every number counts committed rows rather than naming the latest one: two writes can commit out
 * of order, and a "latest id" would then step backwards and hide one of them.
 */
export function pgLive(db: Db): LiveRepo {
  return {
    stamp: (mandateId) =>
      guarded(async () => {
        const rows = rowsOf<{
          attempts: string;
          payment_events: string;
          paypal_ids: string;
          decided_holds: string;
          policy_version: string;
          mandate_step: string;
          vault_deleted: string;
          agents: string;
          revoked_agents: string;
        }>(
          await db.execute(sql`
          select
            (select count(*) from attempts a where a.mandate_id = ${mandateId}) as attempts,
            (select count(*) from payment_events e
               join attempts a on a.id = e.attempt_id
              where a.mandate_id = ${mandateId}) as payment_events,
            (select
               count(p.paypal_order_id) + count(p.authorization_id) + count(p.capture_id)
             from payments p
               join attempts a on a.id = p.attempt_id
              where a.mandate_id = ${mandateId}) as paypal_ids,
            (select count(*) from holds h
               join attempts a on a.id = h.attempt_id
              where a.mandate_id = ${mandateId} and h.decided_at is not null) as decided_holds,
            (select coalesce(max(version), 0) from policies where mandate_id = ${mandateId})
              as policy_version,
            (select case m.status when 'ACTIVE' then 1 when 'REVOKED' then 2 else 0 end
             from mandates m where m.id = ${mandateId}) as mandate_step,
            (select case when m.vault_deleted_at is null then 0 else 1 end
             from mandates m where m.id = ${mandateId}) as vault_deleted,
            (select count(*) from agents g where g.mandate_id = ${mandateId}) as agents,
            (select count(g.revoked_at) from agents g where g.mandate_id = ${mandateId})
              as revoked_agents
        `),
        );
        const row = rows[0];
        const count = (value: string | number | null | undefined): number => Number(value ?? 0);
        const stamp: ChangeStamp = {
          attempts: count(row?.attempts),
          paymentEvents: count(row?.payment_events),
          paypalIds: count(row?.paypal_ids),
          decidedHolds: count(row?.decided_holds),
          policyVersion: count(row?.policy_version),
          mandateStep: count(row?.mandate_step),
          vaultDeleted: count(row?.vault_deleted),
          agents: count(row?.agents),
          revokedAgents: count(row?.revoked_agents),
        };
        return stamp;
      }),
  };
}
