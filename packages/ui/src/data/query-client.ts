import { QueryClient } from "@tanstack/react-query";
import { SlipClientError } from "./client.js";

/**
 * The cache the kit's hooks share. Data is kept fresh by live updates rather than by refetching on
 * focus or on a timer, so it counts as fresh for a while once loaded (a server-rendered page does
 * not refetch the moment it hydrates). Only a server failure is retried, twice: being signed out,
 * a missing receipt or a response of the wrong shape will not fix itself.
 */
export function createSlipQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failures, error) =>
          failures < 2 && error instanceof SlipClientError && error.kind === "server",
      },
      mutations: { retry: false },
    },
  });
}
