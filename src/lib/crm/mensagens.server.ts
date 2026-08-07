// Histórico e envio de texto. Usado pelo agente (remetente "ia") e, na Fatia 5,
// pelo Pedro respondendo no inbox (remetente "humano") — uma implementação só.

export async function listarMensagens(
  admin: any,
  conversaId: string,
  limite = 50,
): Promise<any[]> {
  const { data } = await admin
    .from("mensagens")
    .select("id, remetente, direcao, tipo, conteudo, transcricao, transcricao_status, status, timestamp_ms, criado_em")
    .eq("conversa_id", conversaId)
    .order("timestamp_ms", { ascending: false })
    .limit(limite);
  // O banco devolve do mais novo para o mais velho (o índice é assim); a
  // conversa se lê ao contrário.
  return (data ?? []).slice().reverse();
}

export type ParamsEnvio = {
  conversaId: string;
  leadId: string;
  telefone: string | null;
  texto: string;
  remetente: "ia" | "humano";
};

export type DepsEnvio = {
  /** Injetável só para teste. Em produção resolve para a UAZAPI. */
  enviar?: (numero: string, texto: string) => Promise<any>;
};

async function enviarPelaUazapi(numero: string, texto: string): Promise<any> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) throw new Error("UAZAPI_TOKEN não configurado");
  const { enviarTexto } = await import("../uazapi/client.server.ts");
  return enviarTexto(token, numero, texto);
}

/**
 * Grava a mensagem como `pendente`, envia, e só então marca `enviada`.
 *
 * A ordem importa: se gravássemos depois do envio, uma falha na gravação
 * deixaria o lead com uma mensagem que não existe no histórico. Deste jeito o
 * pior caso é uma linha `falhou` visível — nunca um buraco silencioso.
 *
 * Nunca lança: devolve `{ ok: false, erro }`, porque quem chama é o worker e
 * uma exceção aqui derrubaria o turno inteiro.
 */
export async function enviarTextoDoCrm(
  admin: any,
  params: ParamsEnvio,
  deps: DepsEnvio = {},
): Promise<{ ok: boolean; erro?: string }> {
  const texto = params.texto?.trim();
  if (!texto) return { ok: false, erro: "texto vazio" };
  if (!params.telefone) return { ok: false, erro: "lead sem telefone" };

  const { data: mensagem, error } = await admin
    .from("mensagens")
    .insert({
      conversa_id: params.conversaId,
      lead_id: params.leadId,
      remetente: params.remetente,
      direcao: "out",
      tipo: "texto",
      conteudo: texto,
      status: "pendente",
      timestamp_ms: Date.now(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, erro: error.message };

  const enviar = deps.enviar ?? enviarPelaUazapi;

  try {
    const resposta = await enviar(params.telefone, texto);
    // A UAZAPI alterna entre `messageid` e `id` conforme o endpoint — a Fatia 1
    // já tinha apanhado da mesma inconsistência com sourceID/sourceId.
    const providerId = resposta?.messageid ?? resposta?.id ?? null;
    await admin
      .from("mensagens")
      .update({ status: "enviada", provider_message_id: providerId })
      .eq("id", mensagem.id);
    return { ok: true };
  } catch (err: any) {
    const erro = err?.message ?? "erro desconhecido ao enviar";
    await admin.from("mensagens").update({ status: "falhou" }).eq("id", mensagem.id);
    return { ok: false, erro };
  }
}
