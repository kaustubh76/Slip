import "server-only";
import type { AppDeps } from "@slip/app";
import type { OwnerId } from "@slip/domain";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { deps } from "./runtime";
import {
  clearedSessionCookie,
  newSession,
  type OwnerSession,
  sessionCookie,
  sessionCookieName,
  sessionKey,
  verifySession,
} from "./session";

/**
 * The owner behind the current request, from the signed cookie. Every page and action starts
 * here: the owner id it returns is what the owner queries are scoped by, so nothing in a URL can
 * widen what a reader sees.
 */

export interface OwnerContext {
  session: OwnerSession;
  ownerId: OwnerId;
  mandateId: string;
  deps: AppDeps;
}

/** The signed-in owner, or null. */
export async function currentOwner(): Promise<OwnerContext | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (token === undefined) {
    return null;
  }
  const session = verifySession(token, sessionKey(), Date.now());
  if (session === null) {
    return null;
  }
  return {
    session,
    ownerId: session.ownerId as OwnerId,
    mandateId: session.mandateId,
    deps: await deps(),
  };
}

/** The signed-in owner, or away to sign in. For pages and actions that need one. */
export async function requireOwner(): Promise<OwnerContext> {
  const owner = await currentOwner();
  if (owner === null) {
    redirect("/sign-in");
  }
  return owner;
}

export async function startSession(ownerId: string, mandateId: string): Promise<void> {
  const now = Date.now();
  const cookie = sessionCookie(newSession(ownerId, mandateId, now), sessionKey(), now);
  const { name, value, ...options } = cookie;
  (await cookies()).set(name, value, options);
}

export async function endSession(): Promise<void> {
  const { name, value, ...options } = clearedSessionCookie();
  (await cookies()).set(name, value, options);
}
