/**
 * Servidor de produção (Bun) para o TanStack Start.
 *
 * `bun run build` (Vite 8 + @tanstack/react-start, sem Nitro nesta versão)
 * gera:
 *   - dist/client/assets/**  -> assets estáticos do cliente
 *   - dist/server/server.js  -> handler SSR no formato fetch(Request) => Response
 *
 * dist/server/server.js não escuta porta nenhuma sozinho — só exporta
 * `{ fetch }`. Este arquivo é o wrapper que:
 *   1. serve os estáticos de dist/client/assets diretamente;
 *   2. delega qualquer outra rota (páginas SSR, /api/**, server functions)
 *      para o handler gerado pelo build;
 *   3. escuta em 0.0.0.0:$PORT (default 3000), como o EasyPanel espera.
 *
 * Roda com `bun run server.ts` — Bun executa TypeScript nativamente, sem
 * precisar compilar nem instalar devDependencies (vite, plugins, etc.) na
 * imagem final.
 */
import { resolve, sep } from "node:path";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const ROOT_DIR = import.meta.dir;
const CLIENT_DIR = resolve(ROOT_DIR, "dist", "client");
const SERVER_ENTRY = resolve(ROOT_DIR, "dist", "server", "server.js");

type StartHandler = { fetch: (request: Request) => Response | Promise<Response> };

const serverModule = (await import(SERVER_ENTRY)) as { default: StartHandler };
const handler = serverModule.default;

/**
 * Resolve um pathname de URL para um caminho de arquivo dentro de
 * dist/client/assets — e SOMENTE dentro dele. Qualquer coisa que escape via
 * `..`, encoding (%2e%2e), etc. é rejeitada. Mesma classe de proteção usada
 * no path do Storage (ver src/lib) — nunca confiar em path vindo de URL.
 */
function resolveAssetPath(pathname: string): string | null {
  if (!pathname.startsWith("/assets/")) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = resolve(CLIENT_DIR, "." + decoded);
  const isInsideClientDir = candidate === CLIENT_DIR || candidate.startsWith(CLIENT_DIR + sep);
  return isInsideClientDir ? candidate : null;
}

Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request) {
    const url = new URL(request.url);
    const assetPath = resolveAssetPath(url.pathname);

    if (assetPath) {
      const file = Bun.file(assetPath);
      if (await file.exists()) {
        return new Response(file, {
          headers: { "Cache-Control": "public, max-age=31536000, immutable" },
        });
      }
      // Está sob /assets/ mas não existe: cai pro handler (vai virar 404 do router).
    }

    try {
      return await handler.fetch(request);
    } catch (error) {
      console.error("[server] erro não tratado:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
  error(error) {
    console.error("[server] erro não tratado no Bun.serve:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`TON-CRM-IA ouvindo em http://${HOST}:${PORT}`);
