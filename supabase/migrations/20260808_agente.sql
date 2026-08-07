-- Fatia 2: agendamento do agente, status de envio e tarefas manuais.

-- ===================== CONVERSAS: agendamento e lock =====================
-- responder_em null = nada pendente. O worker varre por esta coluna a cada 3s,
-- então o índice é parcial: só as conversas com algo agendado entram nele.
alter table public.conversas
  add column responder_em timestamptz,
  add column motivo_agendamento text
    check (motivo_agendamento in ('resposta','followup')),
  add column processando_em timestamptz,
  add column tentativas integer not null default 0,
  add column ultimo_erro text,
  add column followup_enviado boolean not null default false;

create index conversas_responder_em_idx
  on public.conversas (responder_em)
  where responder_em is not null;

-- ===================== MENSAGENS: status de envio =====================
-- A mensagem da IA é gravada ANTES do envio. Assim nada que o lead recebeu
-- fica fora do histórico, e nada que falhou some sem rastro.
-- Mensagem recebida (direcao='in') nasce 'enviada': não há envio a fazer.
alter table public.mensagens
  add column status text not null default 'enviada'
    check (status in ('pendente','enviada','falhou'));

-- ===================== LEADS: datas do funil =====================
-- O CPI usa uma coluna de data por etapa, mas lá são 5 estágios e aqui são 8.
-- O histórico completo de transições fica em eventos_lead; só as datas que o
-- dashboard da Fatia 4 realmente consulta viram coluna.
alter table public.leads
  add column estagio_alterado_em timestamptz,
  add column link_enviado_em timestamptz,
  add column motivo_perdido text;

-- ===================== TAREFAS =====================
-- Molde do crm_tasks do CPI, sem a parte de multi-tenancy (uso individual).
-- São os lembretes que o Pedro cria à mão — a IA nunca escreve aqui.
create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  titulo text not null,
  descricao text,
  prazo timestamptz,
  concluida boolean not null default false,
  concluida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index tarefas_pendentes_idx on public.tarefas (concluida, prazo);
create index tarefas_lead_idx on public.tarefas (lead_id);

-- RLS: mesma forma usada pela fundação (20260807_fundacao.sql) para leads,
-- conversas, mensagens etc. — tudo fechado para anônimo, o operador
-- autenticado (public.eh_dono()) enxerga tudo, e o service_role ignora RLS.
alter table public.tarefas enable row level security;
grant select, insert, update, delete on public.tarefas to authenticated;
grant all on public.tarefas to service_role;

create policy tarefas_operador on public.tarefas
  for all to authenticated using (public.eh_dono()) with check (public.eh_dono());
