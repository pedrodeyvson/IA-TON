-- eh_dono() era `select auth.uid() is not null`: QUALQUER conta autenticada
-- passava. Como as 7 policies de RLS (leads, mensagens, conversas,
-- eventos_lead, eventos_capi, tarefas, webhook_events) usam só essa função, e
-- a publishable key vai no bundle do cliente, bastava fazer POST em
-- /auth/v1/signup para receber um JWT e ler todo lead e toda conversa pelo
-- PostgREST. Verificado contra o projeto real em 08/08/2026: conta criada,
-- confirmada e removida.
--
-- Desligar "Allow new users to sign up" no painel também fecha isso, mas é um
-- interruptor que alguém religa sem perceber. Esta migration põe a barreira no
-- banco: ser autenticado deixa de bastar, é preciso estar na lista.

create table if not exists public.donos (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  nota text
);

comment on table public.donos is
  'Quem pode acessar o CRM. Ler auth.uid() daqui é o que eh_dono() faz. '
  'Adicionar operador = insert com o id de auth.users. Nunca exposta ao cliente.';

alter table public.donos enable row level security;
-- Sem policy nenhuma: com RLS ligada e zero policies, o acesso via PostgREST
-- (anon/authenticated) é negado por completo. Só a service role — que ignora
-- RLS — e a própria eh_dono() (SECURITY DEFINER) enxergam a tabela. Isso
-- impede que um autenticado se auto-inclua na lista.

-- Semeia o dono atual. Idempotente.
insert into public.donos (user_id, nota)
select id, 'dono original, semeado pela migration 20260808d'
from auth.users
where email = 'pedrodeyvson15@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.eh_dono()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from public.donos d where d.user_id = auth.uid());
$function$;

comment on function public.eh_dono() is
  'true só para uid presente em public.donos. Antes era auth.uid() is not null, '
  'o que dava acesso total a qualquer conta criada via /auth/v1/signup.';
