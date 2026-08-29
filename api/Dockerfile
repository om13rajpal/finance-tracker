FROM node:22-slim AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared ./shared
COPY api ./api
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter api build
# `pnpm deploy` writes a SELF-CONTAINED, production-only tree at /prod/api: the built
# `dist`, the package manifest, and a node_modules containing just the runtime
# dependencies. That tree is what the runtime stage ships.
#
# This step is load-bearing, not an optimization. The runtime stage previously copied
# the workspace ROOT node_modules, which under pnpm's isolated layout contains only the
# root package's own dev tooling plus the `.pnpm` content-addressed store — every
# runtime dependency (express, mongoose, bullmq, …) lives in `api/node_modules` as a
# symlink into that store and was never copied at all, so `node dist/index.js` in the
# published image could not resolve a single one of them.
#
# `--prod` additionally keeps typescript/tsx/vitest/supertest/mongodb-memory-server out
# of the image entirely. `--legacy` selects the pre-`inject-workspace-packages` deploy
# behaviour, which is what this workspace (no injected packages) is set up for.
RUN pnpm --filter=@finance-tracker/api --prod --legacy deploy /prod/api

FROM node:22-slim
WORKDIR /app
# `shared` is deliberately not copied: nothing in api/src imports it at runtime (it is a
# types-only workspace package), and anything api did depend on would be pulled into the
# deployed tree above by pnpm.
COPY --from=build /prod/api ./
EXPOSE 4000
CMD ["node", "dist/index.js"]
