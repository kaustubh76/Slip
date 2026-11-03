import type { Store } from "@slip/domain";
import type { Db } from "../client.js";
import type { VaultCipher } from "../crypto.js";
import { pgAttempts, pgSnapshots } from "./attempts.js";
import { pgLive } from "./live.js";
import { pgAgents, pgMandates, pgOwners } from "./mandates.js";
import { pgAdmissions, pgImpressions, pgLeases, pgReports, pgWebhooks } from "./misc.js";
import { pgHolds, pgPayments } from "./payments.js";

/** The production `Store`: Postgres through Drizzle, on postgres.js or PGlite. */
export function createPgStore(db: Db, cipher: VaultCipher): Store {
  return {
    owners: pgOwners(db),
    live: pgLive(db),
    mandates: pgMandates(db, cipher),
    agents: pgAgents(db),
    snapshots: pgSnapshots(db),
    attempts: pgAttempts(db, cipher),
    payments: pgPayments(db),
    holds: pgHolds(db, cipher),
    webhooks: pgWebhooks(db),
    leases: pgLeases(db),
    impressions: pgImpressions(db),
    reports: pgReports(db),
    admissions: pgAdmissions(db),
  };
}
