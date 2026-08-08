# syntax=docker/dockerfile:1
#
# Build de produção do TON-CRM-IA (TanStack Start + Vite 8, runtime Bun).
#
# Importante: esta versão do @tanstack/react-start NÃO usa Nitro (verificado
# lendo node_modules/@tanstack/start-plugin-core e o resultado real de
# `bun run build`). O build gera:
#   dist/client/assets/**  -> estáticos do client
#   dist/server/server.js  -> handler SSR no formato fetch(Request) => Response,
#                             que não escuta porta nenhuma sozinho.
# `server.ts` (raiz do repo) é o wrapper que serve dist/client/assets e
# delega o resto para esse handler, escutando 0.0.0.0:$PORT.

########################################
# Stage 1: deps — todas as dependências (para poder buildar)
########################################
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

########################################
# Stage 2: build — compila client + server
########################################
FROM oven/bun:1 AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock vite.config.ts tsconfig.json ./
COPY src ./src

RUN bun run build

########################################
# Stage 3: runtime — imagem final enxuta
#   Sem código-fonte (src/), sem devDependencies (vite e plugins ficam só
#   nos stages de build). Só o necessário para `bun run server.ts` servir
#   o build já pronto.
########################################
FROM oven/bun:1-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN groupadd --system app && useradd --system --gid app --home-dir /app app

# Só manifestos primeiro, para cache de layer eficiente.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
    && rm -rf /root/.bun/install/cache

COPY --from=build /app/dist ./dist
COPY server.ts ./server.ts

RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
