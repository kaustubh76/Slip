import { describeStoreContract } from "./__contract__/store-contract.js";
import { createMemoryStore } from "./memory/store.js";

describeStoreContract("in-memory fake", async () => ({
  store: createMemoryStore(),
  close: async () => {},
}));
