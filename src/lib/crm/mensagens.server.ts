// Histórico e envio de texto. Usado pelo agente (remetente "ia") e, na Fatia 4,
// pelo Pedro respondendo no inbox (remetente "humano") — uma implementação só.

export async function listarMensagens(
  admin: any,
  conversaId: string,
  limite = 50,
): Promise<any[]> {
  const { data } = await admin
    .from("mensagens")
    .select("id, remetente, direcao, tipo, conteudo, transcricao, transcricao_status, media_path, status, timestamp_ms, criado_em")
    .eq("conversa_id", conversaId)
    .order("timestamp_ms", { ascending: false })
    // Desempate por id: duas mensagens com o MESMO timestamp_ms (comum quando
    // o lead manda duas seguidas) sairiam em ordem arbitrária, e a cada poll
    // de 5s a ordem podia trocar — o que muda qual é a "última" mensagem e
    // reembaralha a tela sem nada ter acontecido.
    .order("id", { ascending: false })
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
 * Marca a mensagem como `falhou` depois de um erro no envio. Nunca lança:
 * mesmo que o próprio update falhe (devolvendo `error` ou lançando), a
 * função devolve um `erro` que junta as duas causas em vez de deixar a
 * exceção escapar ou a falha de persistência passar em silêncio.
 */
async function marcarFalhou(
  admin: any,
  mensagemId: string,
  erroEnvio: string,
): Promise<{ ok: boolean; erro?: string }> {
  try {
    const { error: erroUpdate } = await admin
      .from("mensagens")
      .update({ status: "falhou" })
      .eq("id", mensagemId);
    if (erroUpdate) {
      return {
        ok: false,
        erro: `${erroEnvio} (e também falhou ao marcar "falhou" no banco: ${erroUpdate.message})`,
      };
    }
  } catch (erroPersistencia: any) {
    return {
      ok: false,
      erro: `${erroEnvio} (e também lançou ao tentar marcar "falhou" no banco: ${erroPersistencia?.message ?? "erro desconhecido"})`,
    };
  }
  return { ok: false, erro: erroEnvio };
}

/**
 * Grava a mensagem como `pendente`, envia, e só então marca `enviada`.
 *
 * A ordem importa: se gravássemos depois do envio, uma falha na gravação
 * deixaria o lead com uma mensagem que não existe no histórico. Deste jeito o
 * pior caso é uma linha `falhou` visível — nunca um buraco silencioso.
 *
 * Nunca lança: devolve `{ ok, erro }`, porque quem chama é o worker e uma
 * exceção aqui derrubaria o turno inteiro. Os updates de status (`enviada` e
 * `falhou`) também têm o `error` do supabase-js checado explicitamente — ele
 * resolve com `{data, error}` em vez de rejeitar, então ignorar esse campo
 * deixaria a linha presa em `pendente` sem ninguém saber. Quando o envio
 * pela UAZAPI teve sucesso mas o update para `enviada` falha, `ok` continua
 * `true` (a mensagem FOI entregue ao cliente — isso não é uma falha de
 * envio) e o `erro` descreve a falha de persistência separadamente, para
 * quem chama distinguir os dois casos.
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

  let resposta: any;
  try {
    resposta = await enviar(params.telefone, texto);
  } catch (err: any) {
    const erroEnvio = err?.message ?? "erro desconhecido ao enviar";
    return marcarFalhou(admin, mensagem.id, erroEnvio);
  }

  // A UAZAPI alterna entre `messageid` e `id` conforme o endpoint — a Fatia 1
  // já tinha apanhado da mesma inconsistência com sourceID/sourceId.
  const providerId = resposta?.messageid ?? resposta?.id ?? null;
  try {
    const { error: erroUpdate } = await admin
      .from("mensagens")
      .update({ status: "enviada", provider_message_id: providerId })
      .eq("id", mensagem.id);
    if (erroUpdate) {
      return {
        ok: true,
        erro: `mensagem enviada, mas falha ao marcar "enviada" no banco: ${erroUpdate.message}`,
      };
    }
    return { ok: true };
  } catch (erroPersistencia: any) {
    return {
      ok: true,
      erro: `mensagem enviada, mas falha ao marcar "enviada" no banco: ${erroPersistencia?.message ?? "erro desconhecido"}`,
    };
  }
}
