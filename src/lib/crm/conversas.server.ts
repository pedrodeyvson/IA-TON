// Agendamento, lock, pausa e régua da conversa. O worker (src/lib/worker) varre
// por responder_em; tudo que mexe nessa coluna passa por aqui.
//
// O follow-up REUSA o mesmo agendamento da resposta: um loop, um lock, um
// caminho de erro. O cancelamento sai de graça — se o lead responder antes, o
// webhook reagenda com motivo "resposta" e o toque simplesmente deixa de
// existir.
import { TOTAL_DE_TOQUES } from "./regua.ts";

/** Base do backoff: `MS_POR_TENTATIVA * 2 ** tentativas` — 60s na 1ª falha,
 *  120s na 2ª; na 3ª (`MAX_TENTATIVAS`) desiste em vez de calcular um novo prazo. */
export const MS_POR_TENTATIVA = 30_000;

/** Depois de 3 falhas seguidas o agente desiste e o lead vira problema do Pedro. */
export const MAX_TENTATIVAS = 3;

export type ResultadoAgendamento = {
  agendado: boolean;
  motivo?:
    | "nao_perturbe"
    | "bloqueio_suspeito"
    | "erro_ao_verificar_optout"
    | "erro_ao_agendar";
};

/**
 * Escreve o agendamento e só devolve `{ agendado: true }` se o banco aceitou.
 *
 * O supabase-js resolve com `{ data, error }` em vez de rejeitar: ignorar o
 * `error` faz esta função MENTIR que agendou. Foi exatamente isso que
 * transformou uma migration esquecida (o check de `motivo_agendamento` não
 * conhecia 'resgate' — ver 20260809d) numa rajada de 17 mensagens em 60
 * segundos para um cliente real em 08/08/2026: o UPDATE era recusado, o turno
 * devolvia `reagendou: true` sobre um `responder_em` que continuava no
 * passado, e o worker repescava a mesma conversa a cada 3 segundos.
 *
 * `erro_ao_agendar` é tratado pelos chamadores como recusa (fail-closed), do
 * mesmo jeito que `erro_ao_verificar_optout`: sem saber se o próximo toque
 * ficou marcado, o certo é chamar o Pedro, não seguir em frente.
 */
async function escreverAgendamento(
  admin: any,
  conversaId: string,
  campos: Record<string, unknown>,
): Promise<ResultadoAgendamento> {
  const { error } = await admin.from("conversas").update(campos).eq("id", conversaId);
  if (error) {
    console.warn(
      `[conversas] agendamento recusado pelo banco na conversa ${conversaId}: ${error.message}`,
    );
    return { agendado: false, motivo: "erro_ao_agendar" };
  }
  return { agendado: true };
}

/**
 * A instância de WhatsApp é compartilhada com outro projeto do dono: um
 * webhook/worker que esqueça de checar `nao_perturbe` antes de chamar
 * `agendarResposta`/`agendarToque` reabriria follow-up para quem pediu para
 * parar. Por isso a checagem mora aqui dentro, não só no lado de quem chama —
 * defesa em profundidade, não depende de disciplina externa.
 *
 * `bloqueio_suspeito` (Fatia 6, Task 6) tem o MESMO efeito prático de
 * `nao_perturbe` — tira a conversa da fila —, mas causa diferente: não foi o
 * lead que pediu, foi a uazapi recusando a entrega 3 vezes seguidas
 * (`registrarFalhaDeEnvio`). Ver a migration `20260809b_fatia6_bloqueio_suspeito.sql`
 * para o porquê de não reusar `nao_perturbe` para essa causa.
 *
 * Falha fechada: se a própria consulta falhar (rede, Postgres), a resposta é
 * "recusar", não "assumir que está tudo bem" — perder um follow-up legítimo
 * por um erro transitório é um custo aceitável; mandar mensagem para quem
 * pediu para parar (ou para um número que parece bloqueado) não é.
 */
async function motivoParaRecusarAgendamento(
  admin: any,
  conversaId: string,
): Promise<"nao_perturbe" | "bloqueio_suspeito" | "erro_ao_verificar_optout" | null> {
  const { data, error } = await admin
    .from("conversas")
    .select("id, leads(nao_perturbe, bloqueio_suspeito)")
    .eq("id", conversaId)
    .maybeSingle();
  if (error) return "erro_ao_verificar_optout";
  if (data?.leads?.nao_perturbe === true) return "nao_perturbe";
  if (data?.leads?.bloqueio_suspeito === true) return "bloqueio_suspeito";
  return null;
}

export async function agendarResposta(
  admin: any,
  conversaId: string,
  atrasoMs: number,
  agoraMs: number = Date.now(),
): Promise<ResultadoAgendamento> {
  const motivoRecusa = await motivoParaRecusarAgendamento(admin, conversaId);
  if (motivoRecusa) {
    return { agendado: false, motivo: motivoRecusa };
  }
  return escreverAgendamento(admin, conversaId, {
    responder_em: new Date(agoraMs + atrasoMs).toISOString(),
    motivo_agendamento: "resposta",
    // Mensagem nova reabre o crédito: uma falha de ontem não pode condenar a
    // resposta de hoje.
    tentativas: 0,
    ultimo_erro: null,
  });
}

/** Agenda um toque da régua no instante exato que `planejarProximoToque` devolveu. */
export async function agendarToque(
  admin: any,
  conversaId: string,
  quandoIso: string,
): Promise<ResultadoAgendamento> {
  const motivoRecusa = await motivoParaRecusarAgendamento(admin, conversaId);
  if (motivoRecusa) {
    return { agendado: false, motivo: motivoRecusa };
  }
  return escreverAgendamento(admin, conversaId, {
    responder_em: quandoIso,
    motivo_agendamento: "followup",
    tentativas: 0,
    ultimo_erro: null,
  });
}

/**
 * Agenda um toque do RESGATE pré-link (spec §4) — mesmo mecanismo de
 * `agendarToque` (checa `nao_perturbe` antes de escrever, falha fechada),
 * mas grava em `resgate_toque` em vez de `followup_toque`: contador PRÓPRIO,
 * porque o resgate é uma cadência SEPARADA da régua oficial e não pode
 * consumir o crédito dela (`followup_toque` tem `check between 0 and 4` e é
 * contado pela régua real).
 *
 * Diferente de `registrarToqueEnviado` (que só grava depois que a mensagem do
 * toque JÁ saiu), aqui `resgate_toque` é gravado no momento do AGENDAMENTO —
 * o resgate não tem a etapa de "toque enviado" separada da régua oficial;
 * `resgate_toque` representa "o toque que está agendado ou acabou de sair",
 * lido por quem monta a instrução do turno (`instrucaoDoResgate`) quando o
 * worker disparar esta linha do tempo.
 */
export async function agendarResgate(
  admin: any,
  conversaId: string,
  toque: number,
  quandoIso: string,
): Promise<ResultadoAgendamento> {
  const motivoRecusa = await motivoParaRecusarAgendamento(admin, conversaId);
  if (motivoRecusa) {
    return { agendado: false, motivo: motivoRecusa };
  }
  return escreverAgendamento(admin, conversaId, {
    resgate_toque: toque,
    responder_em: quandoIso,
    motivo_agendamento: "resgate",
    tentativas: 0,
    ultimo_erro: null,
  });
}

export async function registrarToqueEnviado(
  admin: any,
  conversaId: string,
  toque: number,
): Promise<void> {
  if (!Number.isInteger(toque) || toque < 1 || toque > TOTAL_DE_TOQUES) {
    throw new Error(`toque ${toque} fora da cadência (1..${TOTAL_DE_TOQUES})`);
  }
  await admin
    .from("conversas")
    .update({ followup_toque: toque, followup_enviado: true })
    .eq("id", conversaId);
}

/** Pausa obrigatória de 30 dias depois do 4º toque sem resposta. */
export async function pausarCiclo(
  admin: any,
  conversaId: string,
  ateIso: string,
): Promise<void> {
  await admin
    .from("conversas")
    .update({
      ciclo_pausado_ate: ateIso,
      responder_em: null,
      motivo_agendamento: null,
      processando_em: null,
    })
    .eq("id", conversaId);
}

/**
 * Zera o ciclo — usado quando um novo ciclo pode começar (link novo).
 *
 * Zera também o RESGATE (`resgate_toque`/`resgate_pausado_ate`): o link que
 * acabou de sair encerra o resgate pré-link e transfere a conversa para a
 * régua oficial — sem isso, um resgate que ficou no meio da cadência (ex.:
 * toque 2 já agendado) sobreviveria ao link e poderia disparar depois, com o
 * lead já em acompanhamento oficial.
 */
export async function reiniciarCiclo(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({
      followup_toque: 0,
      followup_enviado: false,
      ciclo_pausado_ate: null,
      resgate_toque: 0,
      resgate_pausado_ate: null,
    })
    .eq("id", conversaId);
}

export async function limparAgendamento(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ responder_em: null, motivo_agendamento: null, processando_em: null })
    .eq("id", conversaId);
}

/**
 * Solta só o lock, preservando responder_em.
 *
 * É o que o worker usa quando o turno JÁ agendou o próximo toque: chamar
 * limparAgendamento ali apagaria a régua que o agente acabou de montar.
 */
export async function soltarLock(admin: any, conversaId: string): Promise<void> {
  await admin.from("conversas").update({ processando_em: null }).eq("id", conversaId);
}

/**
 * Registra a falha do turno e decide se tenta de novo.
 * `tentativas` é o número já incrementado (1 na primeira falha).
 */
export async function registrarFalha(
  admin: any,
  conversaId: string,
  tentativas: number,
  erro: string,
  agoraMs: number = Date.now(),
): Promise<void> {
  const desistiu = tentativas >= MAX_TENTATIVAS;
  await admin
    .from("conversas")
    .update({
      tentativas,
      ultimo_erro: erro.slice(0, 500),
      // Solta o lock sempre — senão a conversa fica presa até o varredor de
      // órfãos passar.
      processando_em: null,
      responder_em: desistiu
        ? null
        : new Date(agoraMs + MS_POR_TENTATIVA * 2 ** tentativas).toISOString(),
    })
    .eq("id", conversaId);
}

/** 3 rejeições CONSECUTIVAS do destinatário e a Mika para de insistir. */
export const MAX_FALHAS_DESTINATARIO = 3;

/**
 * Registra o resultado de um ENVIO quanto ao destinatário — contador
 * separado de `registrarFalha`/`tentativas` (que mede falha TOTAL do turno,
 * com backoff). Aqui só entra falha classificada como "o destinatário
 * bloqueou/o número não existe" (`ehFalhaDoDestinatario`, em
 * `src/lib/uazapi/erros.ts`); falha transitória (rede, rate limit, timeout)
 * nunca chega aqui — quem chama (`enviarTextoDoCrm`) já filtrou isso, e
 * continua sendo domínio exclusivo de `registrarFalha`.
 *
 * Não incrementa e não zera nada quando a falha é transitória — o contador
 * fica parado esperando o próximo envio, exatamente como `falhas_destinatario`
 * foi documentado na migration da Task 1: "consecutivas; qualquer envio
 * bem-sucedido zera". Uma falha transitória no meio não é um envio
 * bem-sucedido, então não zera; e não é do destinatário, então não incrementa.
 *
 * Na 3ª falha consecutiva: marca `leads.bloqueio_suspeito` (não
 * `nao_perturbe` — ver a migration para o porquê) e tira a conversa da fila
 * agora mesmo (`limparAgendamento`), em vez de esperar o próximo tick do
 * worker tentar de novo e falhar uma 4ª vez.
 */
export async function registrarFalhaDeEnvio(
  admin: any,
  conversaId: string,
  leadId: string,
  falhaDoDestinatario: boolean,
): Promise<void> {
  if (!falhaDoDestinatario) return;

  const { data } = await admin
    .from("conversas")
    .select("falhas_destinatario")
    .eq("id", conversaId)
    .maybeSingle();
  const falhas = (data?.falhas_destinatario ?? 0) + 1;

  await admin.from("conversas").update({ falhas_destinatario: falhas }).eq("id", conversaId);

  if (falhas >= MAX_FALHAS_DESTINATARIO) {
    await admin
      .from("leads")
      // precisa_atencao junto, mesmo padrão de registrarNaoPerturbe: um
      // número que parece bloqueado é o Pedro quem decide o que fazer (checar
      // por outro canal, etc.) — não pode ficar silencioso.
      .update({ bloqueio_suspeito: true, precisa_atencao: true })
      .eq("id", leadId);
    await limparAgendamento(admin, conversaId);
  }
}

/** Qualquer envio bem-sucedido reabre o crédito — mesmo espírito de
 *  `agendarResposta` zerando `tentativas` numa mensagem nova. */
export async function zerarFalhasDestinatario(admin: any, conversaId: string): Promise<void> {
  await admin.from("conversas").update({ falhas_destinatario: 0 }).eq("id", conversaId);
}

export async function pausarIa(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ pausada_pela_ia: true, assumida_em: new Date().toISOString() })
    .eq("id", conversaId);
}

export async function retomarIa(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ pausada_pela_ia: false, assumida_em: null })
    .eq("id", conversaId);
}

export async function marcarLida(admin: any, leadId: string): Promise<void> {
  await admin.from("leads").update({ nao_lidas: 0 }).eq("id", leadId);
}

/**
 * Estado mínimo de UMA conversa, para a tela de conversa individual.
 *
 * `listarConversas` não serve pra isso: ela é limitada às 50 leads mais
 * recentes, e uma conversa fora dessa janela devolveria `undefined` no
 * front — que um `!undefined?.pausada_pela_ia` interpretaria como "IA
 * ativa", mentindo pro operador exatamente sobre quem está no controle.
 *
 * `null` é "a conversa não existe"; erro de leitura LANÇA em vez de virar
 * `null` — confundir os dois deixaria a tela afirmar um estado de controle
 * que nunca chegou a verificar.
 */
export async function obterEstadoConversa(
  admin: any,
  conversaId: string,
): Promise<{ pausadaPelaIa: boolean } | null> {
  const { data, error } = await admin
    .from("conversas")
    .select("id, pausada_pela_ia")
    .eq("id", conversaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { pausadaPelaIa: Boolean(data.pausada_pela_ia) };
}

/** Lista para o inbox da Fatia 4: lead + estado da conversa, mais recente primeiro. */
export async function listarConversas(admin: any, limite = 50): Promise<any[]> {
  const { data } = await admin
    .from("leads")
    .select(
      "id, nome, telefone, estagio, precisa_atencao, nao_perturbe, nao_lidas," +
        " ultima_mensagem_em, ultima_mensagem_preview, ultima_mensagem_direcao," +
        " foto_path, maquina_interesse, origem, ad_title," +
        " conversas(id, pausada_pela_ia, followup_toque, ciclo_pausado_ate)",
    )
    // `nullsFirst: false` é obrigatório: no Postgres, ORDER BY ... DESC é
    // NULLS FIRST por padrão, então todo lead sem mensagem (recém-criado, ou
    // semeado) subia ao topo do inbox e empurrava as conversas de verdade
    // para baixo — o oposto do que "mais recente primeiro" quer dizer.
    .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
    .limit(limite);
  return data ?? [];
}
