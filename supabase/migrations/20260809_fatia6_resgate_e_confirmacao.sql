-- Fatia 6 (revisão comercial): contador do resgate pré-link, marca de compra
-- confirmada e log de turno do agente. Só o campo — quem usa vem nas próximas
-- tasks desta fatia (docs/superpowers/plans/2026-08-08-fatia-6-revisao-comercial.md).

-- ===================== CONVERSAS: resgate pré-link =====================
-- Medido no banco em 08/08/2026: 7 de 11 leads reais morrem ANTES do link
-- sair, porque a régua (followup_toque, 20260808b) só começa a contar depois
-- dele. resgate_toque é um contador PRÓPRIO para os 4 toques pré-link
-- (1h/3h/6h/12h) — não pode reusar followup_toque: esse já tem
-- `check between 0 and 4` e é da régua oficial, reusar esgotaria a régua real
-- antes dela nem começar.
-- resgate_pausado_ate espelha ciclo_pausado_ate (mesmo papel: trava contra
-- resgate infinito se o worker não avançar o contador), mas para o resgate.
-- falhas_destinatario conta rejeições consecutivas do PRÓPRIO destinatário
-- (WhatsApp recusando a entrega, ex.: bloqueio) — qualquer envio bem-sucedido
-- zera. É a lacuna do CPI (`followup-falhas.ts`) que registrarFalha não cobre
-- hoje: ela mede falha total com backoff, não distingue bloqueio de falha
-- transitória (rede, rate limit).
alter table public.conversas
  add column resgate_toque smallint not null default 0
    check (resgate_toque between 0 and 4),
  add column resgate_pausado_ate timestamptz,
  add column falhas_destinatario smallint not null default 0;

-- ===================== LEADS: compra confirmada =====================
-- null até o lead confirmar EXPLICITAMENTE ("comprei", "finalizei", "fiz o
-- cadastro"). É o fato que decide VENDA/CONFIRMAÇÃO vs SUPORTE (spec §8.1) —
-- e não é o mesmo que estagio = 'convertido': hoje esse valor é atribuído sem
-- confirmação nenhuma (caso real do lead 5521973174307, spec §7.1, "Minor 9"
-- da revisão final da branch anterior). Esta migration só dá o campo; a Task 4
-- desta fatia é quem liga o gatilho.
alter table public.leads
  add column compra_confirmada_em timestamptz;

-- ===================== TURNOS_AGENTE: log de turno =====================
-- Hoje não gravamos turno nenhum: um follow-up ou resgate que falha some sem
-- rastro (foi o que aconteceu com o CAPI por um dia inteiro, spec §6). Esta
-- tabela é só a CAPTURA por turno (origem, status, tokens, tools, erro); a
-- destilação/aprendizado sobre esses dados é item futuro (spec §6/§11, "ciclo
-- de aprendizado"), fora do escopo desta fatia.
create table public.turnos_agente (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  origem text not null check (origem in ('resposta_lead','followup','resgate')),
  status text not null check (status in ('concluido','erro','escalado')),
  tokens_entrada int,
  tokens_saida int,
  tokens_cache int,
  tools_usadas text[],
  erro text,
  criado_em timestamptz not null default now()
);

-- A tela de Histórico (spec §6) lista por lead, mais recente primeiro.
create index turnos_agente_lead_id_idx on public.turnos_agente (lead_id, criado_em desc);

-- RLS: mesmo padrão da fundação (20260807_fundacao.sql) e da tabela tarefas
-- (20260808_agente.sql) — fechado para anônimo, operador autenticado
-- (public.eh_dono(), já corrigida contra a lista de donos em 20260808d) vê
-- tudo, service_role (worker) ignora RLS.
alter table public.turnos_agente enable row level security;
grant select, insert, update, delete on public.turnos_agente to authenticated;
grant all on public.turnos_agente to service_role;

create policy turnos_agente_operador on public.turnos_agente
  for all to authenticated using (public.eh_dono()) with check (public.eh_dono());
