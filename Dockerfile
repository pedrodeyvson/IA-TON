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
# Stage 3: runtime — imagem final
#   Sem devDependencies (vite e plugins ficam só nos stages de build).
#   `src/` PRECISA vir junto: o loop do agente (Fatia 2) é ligado por
#   `server.ts` via import dinâmico direto de módulos em src/ (worker,
#   cliente Supabase) — isso roda fora do bundle SSR do Vite (que só
#   cobre as rotas HTTP em dist/server/), então o Bun precisa achar esses
#   arquivos no filesystem em runtime. Sem src/ aqui, o servidor HTTP sobe
#   normalmente mas o loop do agente falha ao iniciar em silêncio (só um
#   console.error) — a Mika nunca responde a ninguém.
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
COPY src ./src

RUN chown -R app:app /app
USER app

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
