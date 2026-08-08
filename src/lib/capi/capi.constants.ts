// Lógica pura (sem I/O) da integração com a Meta Conversions API (CAPI) em
// modo `action_source: "business_messaging"` (WhatsApp/Click-to-WhatsApp).
//
// Replicado de CPI (src/lib/meta-capi.constants.ts), adaptado ao nosso modelo:
// uso individual, sem organizações, sem multi-tenancy, e com os NOSSOS 8
// estágios de lead (public.leads.estagio) mapeados às 4 colunas do Kanban do
// dono (Novo/Qualificado/Interesse/Venda) em vez dos 4 estágios do CPI.
//
// A Meta recusa `Lead`, `Contact`, `Schedule`, `CompleteRegistration` e
// `SubmitApplication` em business_messaging (catálogo fechado — só valem
// nomes específicos ou eventos custom). O CPI validou contra a API real que
// `LeadSubmitted` (nome custom) e os padrão `AddToCart`, `InitiateCheckout`,
// `Purchase` são aceitos. Ver docs/superpowers/sdd/2026-08-07-fatia-1-fundacao-webhook/capi-report.md.
// `QualifiedLead` foi trocado por `AddToCart` na migration 20260808c_capi_addtocart.sql —
// decisão do dono, para bater com a coluna "Qualificado" do Kanban de 4 colunas.
//
// A tabela `eventos_capi` (migration 20260808c_capi_addtocart.sql) restringe
// `nome_evento` a exatamente esses 4 nomes — o mapeamento abaixo foi desenhado
// para caber nessa constraint.

export const EVENTOS_CAPI_VALIDOS = [
  "LeadSubmitted",
  "AddToCart",
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

/** Mapeamento etapa -> evento CAPI. FIXO — não é configurável, espelha as 4
 *  colunas do Kanban do dono: Novo (LeadSubmitted, disparado no ingest),
 *  Qualificado (AddToCart, tanto em apresentando_solucao quanto em
 *  contornando_objecao — mesmo evento, a cascata não duplica), Interesse
 *  (InitiateCheckout, ao enviar o link) e Venda (Purchase, com valor).
 *  `qualificando` e `acompanhamento` são refinamento dentro da coluna
 *  anterior, sem evento próprio. `perdido` fica fora do funil. */
export const ESTAGIO_EVENTO_MAP: Record<EstagioLead, EventoCapi | null> = {
  novo: "LeadSubmitted",
  qualificando: null,
  apresentando_solucao: "AddToCart",
  contornando_objecao: "AddToCart",
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
 *  da etapa de destino que possuem evento mapeado. Deduplicado por evento: se
 *  mais de uma etapa mapear para o mesmo evento (ex.: apresentando_solucao e
 *  contornando_objecao, ambas AddToCart), só a primeira etapa que o produz
 *  entra na cascata — não faz sentido disparar o mesmo evento duas vezes para
 *  o mesmo avanço. Destino fora do funil (ex.: "perdido", nome desconhecido)
 *  -> []. */
export function resolverCascataEventos(
  estagioDestino: string,
): Array<{ estagio: EstagioLead; evento: EventoCapi }> {
  const destIdx = ORDEM_FUNIL.indexOf(estagioDestino as EstagioLead);
  if (destIdx < 0) return [];
  const out: Array<{ estagio: EstagioLead; evento: EventoCapi }> = [];
  const eventosVistos = new Set<EventoCapi>();
  for (let i = 0; i <= destIdx; i++) {
    const estagio = ORDEM_FUNIL[i];
    const evento = ESTAGIO_EVENTO_MAP[estagio];
    if (!evento || eventosVistos.has(evento)) continue;
    eventosVistos.add(evento);
    out.push({ estagio, evento });
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
