# Slip's hosted demo: one long-lived Node process.
#
# Demo mode keeps the stand-in Channel3 and the stand-in PayPal in this process, and gives every
# visitor a throwaway desk — so it needs a server that outlives a request. `isDemo()` refuses to
# turn on wherever `VERCEL` is set, which is why the demo is a container and not a serverless
# deployment (D74). Nothing here needs a database: with no `DATABASE_URL`, demo mode uses the
# in-memory store, and desks are meant to be thrown away.
#
#   docker build -t slip .
#   docker run -p 3000:3000 -e SLIP_BASE_URL=https://your.host slip
#
# To run the real thing instead, leave `SLIP_DEMO` unset and pass the keys from `.env.example`.
# A real deployment also needs its schema: `pnpm db:migrate` against `DATABASE_URL` before the
# first boot, because the server does not migrate Postgres itself — it would race its replicas.

FROM node:22-slim AS build
WORKDIR /slip
RUN corepack enable
# The whole workspace: the build compiles every package, and the lockfile needs each manifest.
COPY . .
RUN pnpm install --frozen-lockfile && pnpm web:build

FROM node:22-slim AS run
WORKDIR /slip
RUN corepack enable
# `serverExternalPackages` keeps the workspace packages out of the bundle so each is loaded once
# (D42), so the server needs them on disk at run time — the built app alone is not enough.
COPY --from=build /slip /slip

ENV NODE_ENV=production
ENV SLIP_DEMO=1
ENV PORT=3000
# Pretend latency, so the demo does not answer suspiciously faster than a real checkout would.
ENV SLIP_DEMO_LATENCY_MS=250
EXPOSE 3000

# Answers once the server is listening; a host that watches this will not route traffic early.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/sign-in').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@slip/web", "start"]
