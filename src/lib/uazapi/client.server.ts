// Server-only: lê process.env e fala com a UAZAPI. Importar só via await import().

const TIMEOUT_MS = 20_000;

function baseUrl(): string {
  const url = process.env.UAZAPI_BASE_URL;
  if (!url) throw new Error("UAZAPI_BASE_URL não configurado");
  return url.replace(/\/+$/, "");
}

export async function uazapiFetch(
  path: string,
  opts: { token?: string; method?: string; body?: unknown } = {},
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
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

// NUNCA usar webhook global (endpoint /webhook com admintoken): o servidor
// UAZAPI é compartilhado com outras instâncias de outro projeto, e um webhook
// nesse nível afetaria todas elas, não só a nossa. Removido de propósito —
// decisão do dono do projeto.
//
// A UAZAPI expõe configuração de webhook por instância (com o header `token`,
// sem `admintoken`), mas o endpoint exato não está confirmado aqui sem
// consultar a documentação da instância contratada — por isso não foi
// reimplementado às cegas. Por ora o webhook desta instância é configurado
// manualmente no painel da UAZAPI.
