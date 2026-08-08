// Puro: as guardas que decidem se o turno acontece, e em que modo. Ficam fora do
// agente.server.ts para serem testáveis sem banco e sem OpenAI — são elas que
// impedem o agente de falar quando não deve, que é o erro mais caro possível.
import { cicloEstaPausado, MS_POR_DIA, TOTAL_DE_TOQUES } from "../crm/regua.ts";

/** Quantas mensagens do histórico vão para o modelo. Controla custo e latência. */
export const JANELA_HISTORICO = 30;

/** Trava de segurança: no máximo um toque por dia, por conversa. */
export const MS_ENTRE_TOQUES = MS_POR_DIA;

export type MotivoRecusa =
  | "agente_desligado"
  | "nao_perturbe"
  | "conversa_pausada"
  | "lead_escalado"
  | "lead_sem_telefone"
  | "sem_mensagem_do_lead"
  | "ciclo_encerrado"
  | "ciclo_pausado"
  | "toque_recente_demais";

export type ContextoTurno = {
  agenteAtivo: boolean;
  motivo: "resposta" | "followup" | "resgate";
  pausada: boolean;
  precisaAtencao: boolean;
  /** leads.nao_perturbe — o lead pediu para parar. É definitivo. */
  naoPerturbe: boolean;
  temTelefone: boolean;
  /** remetente da última mensagem da conversa: "lead" | "ia" | "humano" */
  ultimoRemetente: string;
  /** conversas.followup_toque — quantos toques já saíram neste ciclo. */
  toqueAtual: number;
  cicloPausadoAte: string | null;
  /** timestamp da última mensagem que saiu daqui (IA ou Pedro). */
  ultimaMensagemIaMs: number | null;
  agoraMs: number;
};

export type Decisao = { responder: true } | { responder: false; motivo: MotivoRecusa };

export function decidirTurno(ctx: ContextoTurno): Decisao {
  if (!ctx.agenteAtivo) return { responder: false, motivo: "agente_desligado" };
  // Antes de precisa_atencao: o opt-out também liga aquela flag, e o motivo
  // preciso é o que aparece no log do worker.
  if (ctx.naoPerturbe) return { responder: false, motivo: "nao_perturbe" };
  if (ctx.pausada) return { responder: false, motivo: "conversa_pausada" };
  if (ctx.precisaAtencao) return { responder: false, motivo: "lead_escalado" };
  if (!ctx.temTelefone) return { responder: false, motivo: "lead_sem_telefone" };

  if (ctx.motivo === "followup") {
    // A pausa é checada ANTES do fim de ciclo: assim que o 4º toque sai, o
    // worker já grava ciclo_pausado_ate — nesse ponto toqueAtual == 4 E a
    // pausa está ativa ao mesmo tempo, e quem explica por que não se fala com
    // o lead é a pausa, não "ciclo encerrado" (que fica reservado para o caso
    // sem pausa registrada — bug de gravação, não o caminho normal).
    if (cicloEstaPausado(ctx.cicloPausadoAte, ctx.agoraMs)) {
      return { responder: false, motivo: "ciclo_pausado" };
    }
    if (ctx.toqueAtual >= TOTAL_DE_TOQUES) return { responder: false, motivo: "ciclo_encerrado" };
    // Trava contra bug de agendamento: dois toques no mesmo dia viram
    // perseguição, e é o próprio material que proíbe.
    if (
      ctx.ultimaMensagemIaMs !== null &&
      ctx.agoraMs - ctx.ultimaMensagemIaMs < MS_ENTRE_TOQUES
    ) {
      return { responder: false, motivo: "toque_recente_demais" };
    }
    // O toque existe justamente porque o lead NÃO respondeu: aqui não se exige
    // mensagem dele.
    return { responder: true };
  }

  if (ctx.motivo === "resgate") {
    // O resgate pré-link não tem teto fixo nem pausa (decisão §9 da spec: o
    // limite de 4 toques é governado por sinal, não por norma, e cai fora
    // depois do link sair). Quem impede um 5º toque é `planejarProximoResgate`
    // (para de agendar depois do 4º) e o `check between 0 and 4` da coluna
    // `resgate_toque` — não uma trava aqui, que bloquearia o próprio 4º toque
    // (a etapa "toque enviado" do resgate é a mesma do agendamento, ver
    // `agendarResgate`). Mesmo raciocínio do followup: o toque existe porque
    // o lead NÃO respondeu, então não se exige que a última mensagem seja
    // dele.
    return { responder: true };
  }

  // Resposta normal: se a última mensagem não é do lead, o agendamento ficou
  // órfão (ex.: o Pedro respondeu no meio). Responder seria falar sozinho.
  if (ctx.ultimoRemetente !== "lead") return { responder: false, motivo: "sem_mensagem_do_lead" };

  return { responder: true };
}

/**
 * Venda até o lead comprar; pós-venda depois disso.
 *
 * O gatilho é o estágio `convertido`, que só a tool registrar_resultado_compra
 * grava — ou seja, o modo muda pela palavra do lead, que é a única confirmação
 * de compra que existe (a Ton não expõe isso).
 */
export function definirModo(lead: { estagio: string }): "venda" | "pos_venda" {
  return lead.estagio === "convertido" ? "pos_venda" : "venda";
}

const PEDIDOS_CURTOS = new Set(["para", "pare", "parar", "stop", "sair", "cancelar"]);

const PADROES_DE_PARADA = [
  /par(a|e|ar)\s+de\s+(me\s+)?(mandar|enviar|encher|chamar)/,
  /n(a|ã)o\s+quero\s+mais\s+(receber|mensagem|mensagens|nada|contato)/,
  /n(a|ã)o\s+me\s+(mande|manda|envie|envia|perturbe|perturba|incomode|chame|chama)/,
  /(me\s+)?(tira|tire|remove|remova|exclui|exclua)\s+(me\s+)?(da|dessa|desta|de sua|da sua)\s+lista/,
  /sair\s+d(a|essa|esta)\s+lista/,
  /descadastr/,
];

/**
 * Rede de segurança determinística para o opt-out.
 *
 * O modelo também tem a tool, mas pedir para parar é o único caso em que errar
 * custa o relacionamento inteiro — então não depende só do julgamento dele.
 */
export function pediuParaParar(texto: string | null | undefined): boolean {
  if (!texto) return false;

  const limpo = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[!.,;:?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpo) return false;
  // "para" sozinho é opt-out; "para qual conta cai?" não é.
  if (PEDIDOS_CURTOS.has(limpo)) return true;

  return PADROES_DE_PARADA.some((padrao) => padrao.test(limpo));
}

export function recortarHistorico<T>(mensagens: T[]): T[] {
  if (mensagens.length <= JANELA_HISTORICO) return mensagens;
  return mensagens.slice(-JANELA_HISTORICO);
}
