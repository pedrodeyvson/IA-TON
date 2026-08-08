-- Troca QualifiedLead por AddToCart no catálogo de eventos CAPI. Decisão do
-- dono: o Kanban tem 4 colunas (Novo/Qualificado/Interesse/Venda) mapeadas
-- aos eventos padrão do Meta Ads que ELE escolheu — exceto a coluna Novo,
-- onde a Meta recusa o evento padrão `Lead` em business_messaging (erro
-- "Invalid parameter", documentado em CPI/src/lib/meta-capi.constants.ts:4-5
-- com teste de guarda lá). LeadSubmitted (nome custom aceito) continua.
alter table public.eventos_capi drop constraint eventos_capi_nome_evento_check;
alter table public.eventos_capi add constraint eventos_capi_nome_evento_check
  check (nome_evento in ('LeadSubmitted','AddToCart','InitiateCheckout','Purchase'));
