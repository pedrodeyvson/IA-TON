// Cliente HTTP da OpenAI via fetch puro — mesmo padrão de capi.server.ts e
// groq-transcribe.server.ts, sem SDK e sem dependência nova no package.json.
//
// O formato de resposta tratado aqui foi capturado da API real (ver
// fixtures/openai-tool-call.json), não deduzido da documentação.

const URL_CHAT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 45_000;

export type MensagemChat = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};

export type ToolChamada = {
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
};

export type RespostaAgente = {
  texto: string | null;
  toolCalls: ToolChamada[];
};

export type DepsOpenAI = {
  /** Injetável só para teste. */
  fetchImpl?: typeof fetch;
};

export async function chamarOpenAI(
  mensagens: MensagemChat[],
  tools: unknown[],
  deps: DepsOpenAI = {},
): Promise<RespostaAgente> {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) throw new Error("OPENAI_API_KEY não configurado");

  const modelo = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const executarFetch = deps.fetchImpl ?? fetch;

  const resposta = await executarFetch(URL_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      messages: mensagens,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const bruto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`OpenAI ${resposta.status}: ${bruto.slice(0, 300)}`);
  }

  let corpo: any;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    throw new Error(`OpenAI devolveu corpo não-JSON: ${bruto.slice(0, 200)}`);
  }

  const mensagem = corpo?.choices?.[0]?.message ?? {};

  const toolCalls: ToolChamada[] = (mensagem.tool_calls ?? []).map((chamada: any) => ({
    id: chamada?.id ?? "",
    nome: chamada?.function?.name ?? "",
    // A API entrega os argumentos como STRING JSON, não objeto. Um modelo
    // pode truncar ou malformar isso — nesse caso devolve {} e deixa a
    // validação da tool reclamar, em vez de derrubar o turno inteiro.
    argumentos: parsearArgumentos(chamada?.function?.arguments),
  }));

  return { texto: typeof mensagem.content === "string" ? mensagem.content : null, toolCalls };
}

function parsearArgumentos(bruto: unknown): Record<string, unknown> {
  if (typeof bruto !== "string" || bruto.trim() === "") return {};
  try {
    const parseado = JSON.parse(bruto);
    return parseado && typeof parseado === "object" ? parseado : {};
  } catch {
    return {};
  }
}
