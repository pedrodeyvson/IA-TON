// Lógica pura (sem I/O) da integração com a Meta Conversions API (CAPI) em
// modo `action_source: "business_messaging"` (WhatsApp/Click-to-WhatsApp).
//
// Replicado de CPI (src/lib/meta-capi.constants.ts), adaptado ao nosso modelo:
// uso individual, sem organizações, sem multi-tenancy, e com os NOSSOS 8
// estágios de lead (public.leads.estagio) em vez dos 4 do CPI.
//
// A Meta recusa `Lead`, `Contact`, `Schedule`, `CompleteRegistration` e
// `SubmitApplication` em business_messaging (catálogo fechado — só valem
// nomes específicos ou eventos custom). O CPI validou contra a API real que
// `LeadSubmitted` (nome custom) e os padrão `QualifiedLead`, `InitiateCheckout`,
// `Purchase` são aceitos. Ver docs/superpowers/sdd/2026-08-07-fatia-1-fundacao-webhook/capi-report.md.
//
// A tabela `eventos_capi` (migration 20260807_fundacao.sql) já restringe
// `nome_evento` a exatamente esses 4 nomes — o mapeamento abaixo foi desenhado
// para caber nessa constraint sem precisar de migration nova.

export const EVENTOS_CAPI_VALIDOS = [
  "LeadSubmitted",
  "QualifiedLead",
  "InitiateCheckout",
  "Purchase",
] as const;

export type EventoCapi = (typeof EVENTOS_CAPI_VALIDOS)[number];

export type EstagioLead =
  | "novo"
  | "qualificando"
  | "apresentando_solucao"
  | "contornando_objecao"
  | "link_enviado"
  | "acompanhamento"
  | "convertido"
  | "perdido";

/** Ordem de progressão do funil — usada para calcular a cascata de eventos
 *  quando um lead pula direto de uma etapa distante para outra (ex.:
 *  novo -> convertido sem passar visivelmente pelas etapas intermediárias). */
export const ORDEM_FUNIL: EstagioLead[] = [
  "novo",
  "qualificando",
  "apresentando_solucao",
  "contornando_objecao",
  "link_enviado",
  "acompanhamento",
  "convertido",
];

/** Mapeamento etapa -> evento CAPI. FIXO — não é configurável.
 *  `apresentando_solucao`, `contornando_objecao` e `acompanhamento` não têm
 *  evento próprio: são refinamentos de qualificação/negociação que não
 *  correspondem a um evento distinto no catálogo fechado de business
 *  messaging, e a tabela eventos_capi só aceita os 4 nomes abaixo. `perdido`
 *  fica fora do funil e nunca dispara nada. */
export const ESTAGIO_EVENTO_MAP: Record<EstagioLead, EventoCapi | null> = {
  novo: "LeadSubmitted",
  qualificando: "QualifiedLead",
  apresentando_solucao: null,
  contornando_objecao: null,
  link_enviado: "InitiateCheckout",
  acompanhamento: null,
  convertido: "Purchase",
  perdido: null,
};

function ehEstagioValido(estagio: string): estagio is EstagioLead {
  return ORDEM_FUNIL.includes(estagio as EstagioLead);
}

/** Resolve qual evento CAPI (se houver) corresponde a uma etapa. */
export function resolverEventoEstagio(estagio: string): EventoCapi | null {
  if (!ehEstagioValido(estagio)) return null;
  return ESTAGIO_EVENTO_MAP[estagio] ?? null;
}

/** Retorna, em ordem, os {estagio, evento} do funil da posição 0 até o índice
 *  da etapa de destino que possuem evento mapeado. Destino fora do funil
 *  (ex.: "perdido", nome desconhecido) -> []. */
export function resolverCascataEventos(
  estagioDestino: string,
): Array<{ estagio: EstagioLead; evento: EventoCapi }> {
  const destIdx = ORDEM_FUNIL.indexOf(estagioDestino as EstagioLead);
  if (destIdx < 0) return [];
  const out: Array<{ estagio: EstagioLead; evento: EventoCapi }> = [];
  for (let i = 0; i <= destIdx; i++) {
    const estagio = ORDEM_FUNIL[i];
    const evento = ESTAGIO_EVENTO_MAP[estagio];
    if (evento) out.push({ estagio, evento });
  }
  return out;
}

/** A partir da etapa de destino e dos eventos já disparados com sucesso para
 *  o lead (nomes em `eventos_capi.nome_evento` com envio confirmado),
 *  retorna os eventos que ainda faltam, deduplicados por nome (cada evento
 *  dispara no máximo uma vez por lead). */
export function eventosParaDisparar(
  estagioDestino: string,
  eventosJaEnviados: string[] | null | undefined,
): Array<{ estagio: EstagioLead; evento: EventoCapi }> {
  const enviados = new Set(eventosJaEnviados ?? []);
  const out: Array<{ estagio: EstagioLead; evento: EventoCapi }> = [];
  for (const c of resolverCascataEventos(estagioDestino)) {
    if (enviados.has(c.evento)) continue;
    enviados.add(c.evento);
    out.push(c);
  }
  return out;
}

/** Decide se um evento específico já foi enviado com sucesso para o lead,
 *  a partir das linhas já gravadas em `eventos_capi`. Base da deduplicação —
 *  a Meta NÃO deduplica eventos de business messaging, isso é nosso.
 *  `status_resposta === "ok"` é o único estado que conta como "já enviado";
 *  tentativas com erro (status_resposta começando com "erro:" ou null/
 *  pendente) não bloqueiam novo envio. */
export function jaFoiEnviado(
  registros: Array<{ nome_evento: string; status_resposta?: string | null }> | null | undefined,
  nomeEvento: string,
): boolean {
  return (registros ?? []).some(
    (r) => r.nome_evento === nomeEvento && r.status_resposta === "ok",
  );
}
