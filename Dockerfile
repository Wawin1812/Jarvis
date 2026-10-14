FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY client/package*.json ./client/
RUN npm install

COPY backend ./backend
RUN npm run build --workspace=backend

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm install --omit=dev
COPY --from=build /app/backend/dist ./backend/dist

RUN useradd --create-home --uid 10001 jarvis \
  && mkdir -p /app/data/jarvis \
  && chown -R jarvis:jarvis /app

USER jarvis
EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
