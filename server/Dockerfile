FROM ghcr.io/immich-app/base-server-dev:202610291416@sha256:5f4f9f77059e1cd0182994419a19f4ee045c3fd48e611f5e77623ed63f7aa1e4 AS builder
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  CI=1 \
  COREPACK_HOME=/tmp \
  PNPM_HOME=/buildcache/pnpm-store \
  PATH="/buildcache/pnpm-store:$PATH"

RUN npm install --global corepack@latest && \
  corepack enable pnpm && \
  pnpm config set store-dir "$PNPM_HOME"

WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmfile.cjs ./
# family fork: pnpm patches (see family/upstream-touches.md)
COPY patches ./patches

FROM builder AS sdk

COPY ./packages/sdk/package.json ./packages/sdk/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/sdk install --frozen-lockfile

COPY ./packages/sdk ./packages/sdk/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/sdk build

FROM sdk AS plugin-sdk

COPY ./packages/plugin-sdk/package.json ./packages/plugin-sdk/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/plugin-sdk install --frozen-lockfile

COPY ./packages/plugin-sdk ./packages/plugin-sdk/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/plugin-sdk build

FROM plugin-sdk AS server

COPY ./server/package.json ./server/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich install --frozen-lockfile

COPY ./server ./server/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  pnpm --filter immich build && \
  pnpm --filter immich --prod --no-optional deploy /output/server-pruned
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  SHARP_FORCE_GLOBAL_LIBVIPS=true pnpm --config.verify-deps-before-run=false --dir /output/server-pruned/node_modules/sharp exec npm run build

FROM sdk AS web

COPY ./web/package.json ./web/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich-web install --frozen-lockfile

COPY ./i18n ./i18n/
COPY ./web ./web/

ARG BUILD_ID
ENV IMMICH_BUILD=${BUILD_ID}

RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter immich-web build

FROM sdk AS cli

COPY ./packages/cli/package.json ./packages/cli/package.json
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store pnpm --filter @immich/cli install --frozen-lockfile

COPY ./packages/cli ./packages/cli/
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  pnpm --filter @immich/cli build && \
  pnpm --filter @immich/cli --prod --no-optional deploy /output/cli-pruned

FROM plugin-sdk AS plugins

ARG TARGETPLATFORM

COPY --from=ghcr.io/jdx/mise:2026.10.20@sha256:a3023a390ce9d79343741039d35a36aa41e4fe8198464bf8cc9ffd23ae081a24 /usr/local/bin/mise /usr/local/bin/mise

COPY ./mise.toml ./mise.toml
COPY ./mise.lock ./mise.lock
COPY ./.mise ./.mise
COPY ./packages/plugin-core/mise.toml ./packages/plugin-core/
ENV MISE_TRUSTED_CONFIG_PATHS=/usr/src/app/mise.toml
ENV MISE_DATA_DIR=/buildcache/mise
ENV MISE_DISABLE_TOOLS=flutter
RUN --mount=type=cache,id=mise-tools-${TARGETPLATFORM},target=/buildcache/mise \
  mise install --locked
COPY ./packages/plugin-core ./packages/plugin-core/

# Build plugins
RUN --mount=type=cache,id=pnpm,target=/buildcache/pnpm-store \
  --mount=type=cache,id=mise-tools-${TARGETPLATFORM},target=/buildcache/mise \
  mise //:plugins

# family fork: pet recognition models (family/pets), pinned to exact revisions and checked by sha256
FROM builder AS pet-models
WORKDIR /models
RUN wget -q --tries=5 -O pet-detector-rfdetr-medium.onnx \
    https://huggingface.co/onnx-community/rfdetr_medium-ONNX/resolve/8553cefdd984bbaeb9d9ca8743d6a6a1c3e29dce/onnx/model.onnx && \
  wget -q --tries=5 -O pet-recognition-base.onnx \
    https://huggingface.co/open-noodle/pet-recognition-base/resolve/fa30eb7785ceb764d5c2840c4585fb89821be385/recognition/model.onnx && \
  printf '%s  %s\n' \
    768928acf337ac86d069c9d55a929e11e563c1e1d272a3ffc9366248d66b2654 pet-detector-rfdetr-medium.onnx \
    8691f5f6d0cebbd1602d21def63a34f7a58f78e08b3d4914cb81adcc2efd83f8 pet-recognition-base.onnx \
    | sha256sum -c -

FROM ghcr.io/immich-app/base-server-prod:202610291416@sha256:6211bec52cbccc19076889b0c39ef473a1a1d02ceb635ccd2e0ecb4683e5fd4d

WORKDIR /usr/src/app
ENV NODE_ENV=production \
  NVIDIA_DRIVER_CAPABILITIES=all \
  NVIDIA_VISIBLE_DEVICES=all

COPY --from=server /output/server-pruned ./server
# family fork: pet recognition models
COPY --from=pet-models /models ./sibred-models
COPY --from=web /usr/src/app/web/build /build/www
COPY --from=cli /output/cli-pruned ./cli
COPY --from=plugins /usr/src/app/packages/plugin-core/dist /build/plugins/immich-plugin-core/dist
COPY --from=plugins /usr/src/app/packages/plugin-core/manifest.json /build/plugins/immich-plugin-core/manifest.json
RUN ln -s ../../cli/bin/immich server/bin/immich
COPY LICENSE /licenses/LICENSE.txt
COPY LICENSE /LICENSE

ENV PATH="${PATH}:/usr/src/app/server/bin"

ARG BUILD_ID
ARG BUILD_IMAGE
ARG BUILD_SOURCE_REF
ARG BUILD_SOURCE_COMMIT

ENV IMMICH_BUILD=${BUILD_ID}
ENV IMMICH_BUILD_URL=https://github.com/immich-app/immich/actions/runs/${BUILD_ID}
ENV IMMICH_BUILD_IMAGE=${BUILD_IMAGE}
ENV IMMICH_BUILD_IMAGE_URL=https://github.com/immich-app/immich/pkgs/container/immich-server
ENV IMMICH_REPOSITORY=immich-app/immich
ENV IMMICH_REPOSITORY_URL=https://github.com/immich-app/immich
ENV IMMICH_SOURCE_REF=${BUILD_SOURCE_REF}
ENV IMMICH_SOURCE_COMMIT=${BUILD_SOURCE_COMMIT}
ENV IMMICH_SOURCE_URL=https://github.com/immich-app/immich/commit/${BUILD_SOURCE_COMMIT}

COPY --from=ghcr.io/futo-org/backups/restic-proxy:v1.11.2@sha256:a88252d884d22a55749f45dd39a2458c6391ca3e4d3b0d9e0c2246786cf923be /usr/local/bin/restic-proxy /usr/local/bin/restic-proxy
COPY --from=ghcr.io/futo-org/restic:0.19.1-futo.2@sha256:72a88670ee0bbb5485c74bd9a7fb3f36d46bf3f8e29c6d0886cd6039077a3184 /usr/bin/restic /usr/local/bin/restic

VOLUME /data
EXPOSE 2283
ENTRYPOINT ["tini", "--", "/bin/bash", "-c"]
CMD ["start.sh"]

HEALTHCHECK CMD immich-healthcheck
