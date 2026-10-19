# syntax=docker/dockerfile:1
#
# BaSyx Studio, hosted web deployment (docs/development/deployment-plan.md).
#
#   docker build -t basyx-studio .
#   docker run -p 3000:3000 -e STUDIO_PUBLIC_URL=http://localhost:3000 \
#     -e STUDIO_DATA_KEY=... -e STUDIO_OIDC_ISSUER=... -e STUDIO_OIDC_CLIENT_ID=... basyx-studio

# Base images are named literally so Dependabot can update them. Deno matches
# devEngines.runtime in package.json and is updated together with it; the
# image is multi-arch, so each platform gets its own Deno binary.
FROM denoland/deno:bin-2.9.6 AS deno

# The build emits platform-independent JavaScript and WebAssembly, so it runs
# once on the build host's architecture.
FROM --platform=$BUILDPLATFORM node:26-trixie-slim AS build

ARG STUDIO_VERSION=""
ARG STUDIO_COMMIT_SHA=""
ARG STUDIO_BUILD_DATE=""

ENV CI=true \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    NUXT_TELEMETRY_DISABLED=1

WORKDIR /src

# The packageManager field pins pnpm with its integrity hash; Corepack
# installs exactly that release (as .github/scripts/setup-pnpm.sh does).
# Node 25 and later no longer bundle Corepack, so it is installed from npm.
COPY package.json ./
RUN npm install --global corepack@0.36.0 && corepack enable pnpm && pnpm --version

# The whole tree is needed before the install: the root postinstall runs
# `nuxt prepare`. The store cache keeps repeated installs fast.
COPY . .

# pnpm-workspace.yaml keeps the store next to the checkout (../.pnpm-store).
RUN --mount=type=cache,id=basyx-studio-pnpm-store,target=/.pnpm-store \
    pnpm install --frozen-lockfile

RUN STUDIO_VERSION="${STUDIO_VERSION}" \
    STUDIO_COMMIT_SHA="${STUDIO_COMMIT_SHA}" \
    STUDIO_BUILD_DATE="${STUDIO_BUILD_DATE}" \
    pnpm build

FROM node:26-trixie-slim AS runtime

ARG STUDIO_VERSION=""
ARG STUDIO_COMMIT_SHA=""
ARG STUDIO_BUILD_DATE=""

LABEL org.opencontainers.image.title="BaSyx Studio" \
      org.opencontainers.image.description="View, edit and extend Asset Administration Shells across infrastructures." \
      org.opencontainers.image.vendor="Eclipse BaSyx" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/eclipse-basyx/basyx-studio" \
      org.opencontainers.image.version="${STUDIO_VERSION}" \
      org.opencontainers.image.revision="${STUDIO_COMMIT_SHA}" \
      org.opencontainers.image.created="${STUDIO_BUILD_DATE}"

ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    STUDIO_DATA_DIR=/data \
    STUDIO_DENO_PATH=/usr/local/bin/deno

WORKDIR /app

COPY --from=deno /deno /usr/local/bin/deno
COPY --from=build /src/.output ./
COPY docker/start.mjs docker/healthcheck.mjs docker/base-path.mjs ./

# The service writes only to the data directory and /tmp, so the root file
# system can be mounted read-only. uid 1000 is the image's `node` user.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]

ENTRYPOINT ["node", "/app/start.mjs"]
