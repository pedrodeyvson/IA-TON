// Puro: sem banco, sem env, sem import de alias. Espelha o check de
// public.leads.estagio — se o check mudar no banco, muda aqui junto.

export const ESTAGIOS = [
  "novo",
  "qualificando",
  "apresentando_solucao",
  "contornando_objecao",
  "link_enviado",
  "acompanhamento",
  "convertido",
  "perdido",
] as const;

export type Estagio = (typeof ESTAGIOS)[number];

export function ehEstagio(valor: unknown): valor is Estagio {
  return typeof valor === "string" && (ESTAGIOS as readonly string[]).includes(valor);
}

export function ordemEstagio(e: Estagio): number {
  return ESTAGIOS.indexOf(e);
}

/**
 * Campos a gravar no lead quando ele muda de estágio.
 *
 * Ao contrário do CPI, aqui não há uma coluna de data por etapa (são 8
 * estágios, não 5) — o histórico completo vive em eventos_lead. Só as datas
 * que o dashboard consulta viram coluna, e elas seguem duas regras:
 *  - carimba ao ENTRAR no estágio, uma vez;
 *  - limpa ao RETROCEDER para antes dele, para o dashboard não contar um
 *    marco que deixou de valer.
 */
export function camposDeTransicao(
  de: Estagio,
  para: Estagio,
  agoraIso: string,
): Record<string, unknown> {
  if (de === para) return {};

  const campos: Record<string, unknown> = {
    estagio: para,
    estagio_alterado_em: agoraIso,
  };

  const ordemDe = ordemEstagio(de);
  const ordemPara = ordemEstagio(para);
  const ordemLink = ordemEstagio("link_enviado");

  if (para === "link_enviado") {
    campos.link_enviado_em = agoraIso;
  } else if (ordemDe >= ordemLink && ordemPara < ordemLink) {
    // Retrocedeu para antes do link: o marco não vale mais.
    campos.link_enviado_em = null;
  }

  if (de === "perdido") campos.motivo_perdido = null;

  return campos;
}

// ===================== Critério de ENTRADA por estágio =====================
// Descoberto em 08/08/2026 olhando o banco de produção: QUATRO leads estavam
// em "qualificando" com uma única mensagem — e essa mensagem era o texto
// pré-preenchido do botão do anúncio ("Olá! QUERO ADQUIRIR UMA MÁQUINA DA
// TON."), que o lead nem digitou. `maquina_interesse` nulo em todos. Nada
// tinha sido qualificado.
//
// A causa estava na descrição da ferramenta dada ao modelo: "Estágio atual da
// CONVERSA". Isso faz a IA descrever a própria ação (perguntei algo de
// qualificação, logo estamos qualificando) em vez do que o LEAD demonstrou.
//
// Etapa de funil não é narrativa: ela dispara evento de conversão na Meta
// (ESTAGIO_EVENTO_MAP) e governa a régua de follow-up. Etapa inflada = evento
// falso e otimização de anúncio envenenada. Por isso a regra também vive em
// código: instrução de prompt o modelo contorna, trava não.

export type EvidenciaDoLead = {
  /** Mensagens escritas PELO LEAD que não são a saudação automática do anúncio. */
  respostasDoLead: number;
  /** O lead informou o que usa/quer (maquina_interesse preenchido). */
  temInteresse: boolean;
  /** Saiu link de checkout para este lead. */
  linkEnviado: boolean;
  /** O lead confirmou a compra com todas as letras. */
  compraConfirmada: boolean;
};

/**
 * O lead abriu a conversa clicando no anúncio, e o WhatsApp mandou o texto
 * pronto do botão. Isso NÃO é resposta dele: é o payload do anúncio. Tratar
 * como engajamento é o que inflava a etapa no primeiro contato.
 */
export function ehSaudacaoDeAnuncio(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const t = texto.trim().toLowerCase().replace(/\s+/g, " ");
  const PRONTAS = [
    "olá! quero adquirir uma máquina da ton.",
    "ola! quero adquirir uma maquina da ton.",
    "olá! posso ter mais informações sobre isso?",
    "ola! posso ter mais informacoes sobre isso?",
    "olá! gostaria de saber mais.",
  ];
  return PRONTAS.includes(t);
}

/**
 * O estágio mais avançado que a evidência SUSTENTA. A IA pode pedir menos que
 * isso (recuar é sempre permitido), nunca mais.
 *
 * Deliberadamente não inclui `contornando_objecao` nem `perdido`: os dois são
 * leitura de intenção, não de evidência, e travá-los por contagem de mensagem
 * causaria mais erro do que corrige.
 */
export function estagioMaximoPermitido(ev: EvidenciaDoLead): Estagio {
  if (ev.compraConfirmada) return "convertido";
  if (ev.linkEnviado) return "acompanhamento";
  // Recomendar um modelo exige que o lead tenha dito algo sobre o que precisa.
  if (ev.temInteresse && ev.respostasDoLead >= 1) return "apresentando_solucao";
  // "Qualificando" exige que ele tenha RESPONDIDO alguma coisa. Só ter
  // chegado pelo anúncio é "novo".
  if (ev.respostasDoLead >= 1) return "qualificando";
  return "novo";
}

/**
 * Limita o estágio pedido pela IA ao que a evidência sustenta. Devolve o
 * estágio a gravar e, quando houve corte, o motivo — que vira nota no evento
 * para o dono conseguir auditar por que a IA foi contida.
 */
export function limitarEstagio(
  pedido: Estagio,
  ev: EvidenciaDoLead,
): { estagio: Estagio; cortado: boolean; motivo?: string } {
  // Estados terminais e de objeção não passam por evidência.
  if (pedido === "perdido" || pedido === "contornando_objecao") {
    return { estagio: pedido, cortado: false };
  }
  const teto = estagioMaximoPermitido(ev);
  if (ordemEstagio(pedido) <= ordemEstagio(teto)) return { estagio: pedido, cortado: false };
  return {
    estagio: teto,
    cortado: true,
    motivo:
      `IA pediu "${pedido}" mas a evidência sustenta no máximo "${teto}" ` +
      `(respostas do lead: ${ev.respostasDoLead}, interesse informado: ${ev.temInteresse}, ` +
      `link enviado: ${ev.linkEnviado})`,
  };
}
