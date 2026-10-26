FROM node:22-alpine

# Build-time metadata labels only. The runtime values still come from the
# compose `environment:` block (APP_VERSION / BUILD_SHA / BUILD_DATE), because
# build args never reach the container environment. Pass them with
# --build-arg on the deploy command; see docs/DEPLOY.md.
ARG BUILD_SHA=unknown
ARG APP_VERSION=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.revision=${BUILD_SHA} \
      org.opencontainers.image.version=${APP_VERSION} \
      org.opencontainers.image.created=${BUILD_DATE}

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.mjs"]
