# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS frontend-build
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine AS web
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/dist /usr/share/nginx/html
EXPOSE 80

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY src/seed.js ./src/seed.js
COPY src/subtasks.js ./src/subtasks.js
COPY src/lanes.js ./src/lanes.js
COPY src/validation.js ./src/validation.js
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
