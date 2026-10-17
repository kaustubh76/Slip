"use client";

import {
  type DehydratedState,
  HydrationBoundary,
  type QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useState } from "react";
import type { SlipClient } from "./client.js";
import { createSlipQueryClient } from "./query-client.js";

/** Something changed under the owner's mandate; `moved` names the counters that moved. */
export interface SlipEvent {
  type: "changed";
  moved: readonly string[];
  token: string;
}

interface SlipContextValue {
  client: SlipClient;
  onEvent: ((event: SlipEvent) => void) | undefined;
}

const SlipContext = createContext<SlipContextValue | null>(null);

/**
 * Where a host plugs the kit in: the client (its API and its commands), an optional query cache,
 * and `onEvent` to hear about live changes (to show a toast, say). Every hook reads from here.
 */
export function SlipProvider(props: {
  client: SlipClient;
  queryClient?: QueryClient;
  onEvent?: (event: SlipEvent) => void;
  children: ReactNode;
}) {
  const [own] = useState(createSlipQueryClient);
  return (
    <QueryClientProvider client={props.queryClient ?? own}>
      <SlipContext.Provider value={{ client: props.client, onEvent: props.onEvent }}>
        {props.children}
      </SlipContext.Provider>
    </QueryClientProvider>
  );
}

/** The client and the event hook of the nearest `SlipProvider`. */
export function useSlip(): SlipContextValue {
  const value = useContext(SlipContext);
  if (value === null) {
    throw new Error("Slip hooks need a <SlipProvider> above them");
  }
  return value;
}

/** Puts data a server render already read into the cache, so the page shows it at once. */
export function SlipHydrate(props: { state: DehydratedState; children: ReactNode }) {
  return <HydrationBoundary state={props.state}>{props.children}</HydrationBoundary>;
}
