// Server-only: lê process.env e fala com a UAZAPI. Importar só via await import().

const TIMEOUT_MS = 20_000;

function baseUrl(): string {
  const url = process.env.UAZAPI_BASE_URL;
  if (!url) throw new Error("UAZAPI_BASE_URL não configurado");
  return url.replace(/\/+$/, "");
}

export async function uazapiFetch(
  path: string,
  opts: { token?: string; admin?: boolean; method?: string; body?: unknown } = {},
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.admin) {
    const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
    if (!adminToken) throw new Error("UAZAPI_ADMIN_TOKEN não configurado");
    headers.admintoken = adminToken;
  }
  if (opts.token) headers.token = opts.token;

  const resposta = await fetch(`${baseUrl()}${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texto = await resposta.text();
  let corpo: any = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resposta.ok) {
    throw new Error(`UAZAPI ${resposta.status}: ${texto.slice(0, 200)}`);
  }
  // A UAZAPI às vezes devolve 200 com corpo de erro.
  if (corpo && corpo.error === true) {
    throw new Error(`UAZAPI erro: ${JSON.stringify(corpo).slice(0, 200)}`);
  }
  return corpo;
}

export async function enviarTexto(token: string, numero: string, texto: string) {
  return uazapiFetch("/send/text", { token, body: { number: numero, text: texto } });
}

export async function baixarMensagem(token: string, messageId: string) {
  return uazapiFetch("/message/download", { token, body: { id: messageId } });
}

export async function definirWebhookGlobal(url: string, eventos: string[]) {
  return uazapiFetch("/webhook", { admin: true, body: { url, events: eventos, enabled: true } });
}
