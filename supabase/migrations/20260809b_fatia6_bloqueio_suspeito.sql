-- Fatia 6, Task 6 (falha do destinatário): campo PRÓPRIO para "número parece
-- bloqueado pelo WhatsApp", separado de nao_perturbe.
--
-- Por que não reusar leads.nao_perturbe: essa coluna tem um contrato de UI e
-- de negócio muito específico — "o LEAD pediu para parar", permanente,
-- desfeito só à mão no banco (src/lib/crm/nao-perturbe.server.ts,
-- PainelLead.tsx: "Não perturbe ativo. É permanente por conduta do
-- programa..."). Marcar nao_perturbe=true por causa de uma REJEIÇÃO TÉCNICA
-- da uazapi (número bloqueado/inexistente) mentiria para o operador sobre a
-- causa — ele leria "o lead pediu" quando na verdade é "as últimas 3
-- tentativas de entrega falharam". A causa é diferente, a ação operacional
-- também é (checar o número por outro canal, não respeitar um pedido que
-- nunca existiu). bloqueio_suspeito é a marca correta.
--
-- Efeito prático é o mesmo que nao_perturbe: tira a conversa da fila de
-- reprocessamento. motivoParaRecusarAgendamento (conversas.server.ts) passa a
-- checar os dois campos.
alter table public.leads
  add column bloqueio_suspeito boolean not null default false;
