# Build from the repo root: the server reuses src/sim, src/ai and src/client/assist.js.
FROM node:22-slim
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY package.json ./
COPY src ./src
COPY server ./server
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/index.js"]
