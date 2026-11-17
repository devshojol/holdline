# The multiplayer game server (not the website: that is a static build, see README).
#
#   docker build -t tactical-aim-lab-server .
#   docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://your-site.example tactical-aim-lab-server
#
# The server is one process holding every room in memory: run exactly one instance.

# The project's lockfile is bun's, so bun installs the dependencies; the server itself runs on Node.
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY server ./server
COPY src ./src
# typecheck, then bundle the server and everything it shares with the client into one file
RUN bunx tsc -p server && bun run server:build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY --from=build /app/dist-server/index.cjs ./index.cjs
USER node
EXPOSE 8787
CMD ["node", "index.cjs"]
