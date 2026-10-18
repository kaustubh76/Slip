/**
 * Workspace packages export their TypeScript sources under a private condition, `@slip/source`,
 * and their built `dist` under the standard ones. Tests (here), `tsc -p tsconfig.test.json`
 * (`customConditions`) and `tsx` (`--conditions`) opt in; Next.js does not, so it bundles `dist`.
 * Setting `conditions` replaces Vite's defaults, so they are restated after the private one.
 *
 * The server list deliberately leaves out `module`, which Vite's default includes. Vitest forwards
 * these conditions to the worker as Node `--conditions`, and Node resolves every externalised
 * dependency with them — but Node honours no `module` condition of its own, so a package is free to
 * put a bundler-only build behind that key. `@opentelemetry/api`, a dependency of
 * `@anthropic-ai/sdk`, does exactly that: its `module` build is ESM whose own imports have no file
 * extensions, which Node cannot load. Leaving `module` out makes a test resolve a dependency the
 * same way the deployed app does. The client list keeps it: there, Vite is the one loading.
 */
export const SOURCE_CONDITION = "@slip/source";

const server = [SOURCE_CONDITION, "node", "development|production"];
const client = [SOURCE_CONDITION, "module", "browser", "development|production"];

export const workspaceSources = {
  resolve: { conditions: client },
  ssr: { resolve: { conditions: server } },
};
