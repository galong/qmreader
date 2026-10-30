FROM node:26-slim@sha256:5758d367d7b4f48b73a9bb3530e687e47efb289f3b43f9c0450a25225ae0db5d

WORKDIR /app
ARG APP_REVISION
ENV QMREADER_COMMIT=${APP_REVISION}
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY .rss-reliability ./.rss-reliability
COPY scripts ./scripts
COPY public ./public
COPY README.md ./

RUN mkdir -p data

EXPOSE 8080
CMD ["node", "server.js"]
