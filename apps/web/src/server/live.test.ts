import { type AppDeps, appConfig, randomIds, silentLogger } from "@slip/app";
import { createMemoryStore } from "@slip/db/memory";
import { type MandateId, mandateId, stampToken } from "@slip/domain";
import { ManualClock, NOW, testUuid } from "@slip/domain/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { clearStampCache, STAMP_WINDOW_MS, stampFor, stampTokenFor } from "./live";

function world() {
  const clock = new ManualClock(NOW);
  const base = createMemoryStore();
  let reads = 0;
  const deps = {
    store: {
      ...base,
      live: {
        stamp: async (id: MandateId) => {
          reads += 1;
          return base.live.stamp(id);
        },
      },
    },
    clock,
    ids: randomIds,
    log: silentLogger,
    config: appConfig(),
  } as unknown as AppDeps;
  return { deps, clock, reads: () => reads };
}

describe("the shared change stamp", () => {
  beforeEach(() => {
    clearStampCache();
  });

  it("answers many tabs from one reading, then reads again", async () => {
    const { deps, clock, reads } = world();
    const id = mandateId(testUuid());
    await Promise.all([stampFor(deps, id), stampFor(deps, id), stampFor(deps, id)]);
    expect(reads()).toBe(1);

    // Still inside the window: the same reading.
    clock.advance(STAMP_WINDOW_MS - 1);
    await stampFor(deps, id);
    expect(reads()).toBe(1);

    // Past it: read again, so a change cannot be held back for longer than the window.
    clock.advance(1);
    await stampFor(deps, id);
    expect(reads()).toBe(2);
  });

  it("a failed reading is not kept", async () => {
    const clock = new ManualClock(NOW);
    let fail = true;
    const deps = {
      store: {
        live: {
          stamp: async () => {
            if (fail) {
              throw new Error("the database went away");
            }
            return {
              attempts: 1,
              paymentEvents: 0,
              paypalIds: 0,
              decidedHolds: 0,
              policyVersion: 1,
              mandateStep: 1,
              vaultDeleted: 0,
              agents: 1,
              revokedAgents: 0,
            };
          },
        },
      },
      clock,
      ids: randomIds,
      log: silentLogger,
      config: appConfig(),
    } as unknown as AppDeps;
    const id = mandateId(testUuid());
    await expect(stampFor(deps, id)).rejects.toThrow("the database went away");
    fail = false;
    // Immediately afterwards, inside the window: it tries again rather than serving the failure.
    expect((await stampFor(deps, id)).attempts).toBe(1);
  });

  it("keeps mandates apart", async () => {
    const { deps, reads } = world();
    await stampFor(deps, mandateId(testUuid()));
    await stampFor(deps, mandateId(testUuid()));
    expect(reads()).toBe(2);
  });

  it("gives the token the pages compare", async () => {
    const { deps } = world();
    const id = mandateId(testUuid());
    expect(await stampTokenFor(deps, id)).toBe(stampToken(await stampFor(deps, id)));
  });
});
