import { type Agent, agentId, InvalidIdError, type OwnerId } from "@slip/domain";
import type { AppDeps } from "./deps.js";
import { generateApiKey } from "./keys.js";
import { type OwnerRefusal, ownedMandate, refuseOwner } from "./mandates.js";

/**
 * The owner's agents. Each one acts under one mandate with its own API key; the key is shown
 * once, when issued, and only its hash is kept. Revoking a key stops that agent at once without
 * touching the mandate or the other agents.
 */

const MAX_NAME_LENGTH = 100;

export async function issueAgentKey(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
  input: { name: string },
): Promise<{ status: "issued"; agent: Agent; apiKey: string } | OwnerRefusal> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return refuseOwner("NOT_FOUND", "There is no such mandate.");
  }
  if (owned.status === "REVOKED") {
    return refuseOwner("REVOKED", "This mandate was revoked; it cannot have new agents.");
  }
  const name = input.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return refuseOwner("INVALID_NAME", `Name the agent in 1 to ${MAX_NAME_LENGTH} characters.`);
  }
  const key = generateApiKey();
  const agent = await deps.store.agents.create({
    id: agentId(deps.ids.uuid()),
    mandateId: owned.id,
    name,
    apiKeyHash: key.hash,
    apiKeyPrefix: key.prefix,
    now: deps.clock.now(),
  });
  deps.log.info("agent.key_issued", { agentId: agent.id, mandateId: owned.id });
  return { status: "issued", agent, apiKey: key.key };
}

export async function revokeAgentKey(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<{ status: "revoked"; agent: Agent } | OwnerRefusal> {
  const agent = await ownedAgent(deps, ownerId, id);
  if (agent === null) {
    return refuseOwner("NOT_FOUND", "There is no such agent.");
  }
  const revoked = await deps.store.agents.revoke(agent.id, deps.clock.now());
  if (revoked.result === "applied") {
    deps.log.info("agent.key_revoked", { agentId: agent.id });
  }
  return { status: "revoked", agent: revoked.value };
}

export async function listAgents(
  deps: AppDeps,
  ownerId: OwnerId,
  mandate: string,
): Promise<{ status: "listed"; agents: Agent[] } | OwnerRefusal> {
  const owned = await ownedMandate(deps, ownerId, mandate);
  if (owned === null) {
    return refuseOwner("NOT_FOUND", "There is no such mandate.");
  }
  return { status: "listed", agents: await deps.store.agents.listByMandate(owned.id) };
}

async function ownedAgent(deps: AppDeps, ownerId: OwnerId, id: string): Promise<Agent | null> {
  let agent: Agent | null;
  try {
    agent = await deps.store.agents.get(agentId(id));
  } catch (error) {
    if (error instanceof InvalidIdError) {
      return null;
    }
    throw error;
  }
  return agent !== null && (await ownedMandate(deps, ownerId, agent.mandateId)) !== null
    ? agent
    : null;
}
