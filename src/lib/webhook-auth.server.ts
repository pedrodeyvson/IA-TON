import { comparacaoSegura } from "./webhook-auth.ts";

// Fail-closed: sem segredo configurado, nada passa.
export function segredoConfere(request: Request): boolean {
  const esperado = process.env.UAZAPI_WEBHOOK_SECRET ?? "";
  if (!esperado) return false;
  const url = new URL(request.url);
  const fornecido =
    url.searchParams.get("secret") ?? request.headers.get("x-uazapi-secret") ?? "";
  return comparacaoSegura(fornecido, esperado);
}
