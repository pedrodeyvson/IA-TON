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
