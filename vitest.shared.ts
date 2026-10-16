/**
 * Workspace packages export their TypeScript sources under a private condition, `@slip/source`,
 * and their built `dist` under the standard ones. Tests (here), `tsc -p tsconfig.test.json`
 * (`customConditions`) and `tsx` (`--conditions`) opt in; Next.js does not, so it bundles `dist`.
 * Setting `conditions` replaces Vite's defaults, so they are restated after the private one.
 */
export const SOURCE_CONDITION = "@slip/source";

const server = [SOURCE_CONDITION, "module", "node", "development|production"];
const client = [SOURCE_CONDITION, "module", "browser", "development|production"];

export const workspaceSources = {
  resolve: { conditions: client },
  ssr: { resolve: { conditions: server } },
};
