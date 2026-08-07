-- Fatia 2 (revisão comercial): régua de 4 toques e opt-out permanente.
-- Complementa 20260808_agente.sql, que continua valendo.
--
-- A coluna conversas.followup_enviado vira redundante (a régua tem 4 toques,
-- não 1), mas FICA: renomear quebraria código já escrito e testado. Ela passa a
-- significar "algum toque já saiu neste ciclo".

-- ===================== LEADS: opt-out permanente =====================
-- O lead pediu para parar. Nenhum follow-up dispara nunca mais, em nenhum
-- estágio, e a conversa vai para o Pedro. É definitivo.
alter table public.leads
  add column nao_perturbe boolean not null default false;

-- ===================== CONVERSAS: régua de remarketing =====================
-- followup_toque = quantos toques do ciclo atual já saíram (0 a 4).
-- ciclo_pausado_ate = fim da pausa obrigatória de 30 dias depois do 4º toque
-- sem resposta. Enquanto estiver no futuro, nenhum toque dispara.
alter table public.conversas
  add column followup_toque smallint not null default 0
    check (followup_toque between 0 and 4),
  add column ciclo_pausado_ate timestamptz;

-- O worker já varre por responder_em (índice parcial criado em
-- 20260808_agente.sql). ciclo_pausado_ate não precisa de índice: só é lido
-- depois que a conversa já foi selecionada por responder_em.
