-- Fundação do TON-CRM-IA.
-- Uso individual: um único operador (o consultor). Não há multi-tenancy — a RLS
-- só separa "usuário autenticado" de "anônimo", e o service_role do webhook
-- passa por cima dela para poder gravar mensagens de quem ainda não é usuário.
--
-- ⚠️ ESTE BANCO É COMPARTILHADO com outro sistema em produção (IA_CRM), cujo
-- schema `public` tem 37 tabelas vivas — incluindo uma `webhook_events` com
-- ~1.600 registros. TODO objeto deste projeto vive no schema `ton`. Nunca rode
-- DDL contra `public` aqui.

create schema if not exists ton;

grant usage on schema ton to authenticated, service_role;

-- Espelha em SQL a normalização de telefone feita em src/lib/telefone.ts.
-- IMMUTABLE porque é usada em índice.
create or replace function ton.normalizar_telefone_br(p text)
returns text language plpgsql immutable set search_path = ton, public as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  if length(d) = 13 and substring(d,1,2) = '55' and substring(d,5,1) = '9' then
    return substring(d,1,4) || substring(d,6);
  end if;
  return d;
end; $$;

create or replace function ton.eh_dono()
returns boolean language sql stable security definer set search_path = ton, public as $$
  select auth.uid() is not null;
$$;

create table ton.leads (
  id uuid primary key default gen_random_uuid(),
  telefone text,
  telefone_normalizado text,
  external_id text unique,
  nome text,
  estagio text not null default 'novo'
    check (estagio in ('novo','qualificando','apresentando_solucao','contornando_objecao',
                       'link_enviado','acompanhamento','convertido','perdido')),
  origem text,
  maquina_interesse text,
  comissao_estimada numeric(10,2),
  comissao_confirmada numeric(10,2),
  precisa_atencao boolean not null default false,
  -- Atribuição de anúncio. Todos opcionais: só o lead vindo de anúncio preenche,
  -- e o formato vem de campo não documentado da UAZAPI.
  ad_source_id text,
  ad_source_url text,
  ad_title text,
  ad_source_app text,
  ad_conversion_source text,
  ctwa_clid text,
  ad_referral_raw jsonb,
  -- Desnormalização para a lista do inbox não precisar de subquery.
  ultima_mensagem_em timestamptz,
  ultima_mensagem_preview text,
  ultima_mensagem_direcao text,
  nao_lidas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index leads_telefone_normalizado_idx
  on ton.leads (telefone_normalizado) where telefone_normalizado is not null;
create index leads_ad_source_id_idx
  on ton.leads (ad_source_id) where ad_source_id is not null;
create index leads_estagio_idx on ton.leads (estagio);

create or replace function ton.leads_set_telefone_normalizado()
returns trigger language plpgsql set search_path = ton, public as $$
begin
  new.telefone_normalizado := ton.normalizar_telefone_br(new.telefone);
  new.atualizado_em := now();
  return new;
end; $$;

create trigger trg_leads_normalizar_telefone
  before insert or update on ton.leads
  for each row execute function ton.leads_set_telefone_normalizado();

create table ton.conversas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references ton.leads(id) on delete cascade,
  pausada_pela_ia boolean not null default false,
  assumida_em timestamptz,
  criado_em timestamptz not null default now()
);

create table ton.mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references ton.conversas(id) on delete cascade,
  lead_id uuid not null references ton.leads(id) on delete cascade,
  provider_message_id text,
  remetente text not null check (remetente in ('lead','ia','humano')),
  direcao text not null check (direcao in ('in','out')),
  tipo text not null check (tipo in ('texto','audio','imagem','video','documento','sticker','outro')),
  conteudo text,
  transcricao text,
  transcricao_status text check (transcricao_status in ('ok','failed','pendente')),
  media_path text,
  media_mime text,
  media_filename text,
  timestamp_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  raw jsonb,
  criado_em timestamptz not null default now()
);

-- Segunda camada de idempotência (a primeira é o pré-check no ingest).
create unique index mensagens_provider_message_id_uniq
  on ton.mensagens (provider_message_id) where provider_message_id is not null;
create index mensagens_lead_ts_idx on ton.mensagens (lead_id, timestamp_ms desc);

-- Mantém o preview do inbox atualizado sem subquery na listagem.
create or replace function ton.mensagens_apos_insert()
returns trigger language plpgsql security definer set search_path = ton, public as $$
declare v_preview text;
begin
  v_preview := case new.tipo
    when 'texto' then left(coalesce(new.conteudo, ''), 140)
    when 'audio' then '🎤 Áudio'
    when 'imagem' then '📷 Imagem'
    when 'video' then '🎬 Vídeo'
    when 'documento' then '📎 ' || coalesce(new.media_filename, 'Documento')
    else 'Mensagem'
  end;
  update ton.leads
     set ultima_mensagem_em = to_timestamp(new.timestamp_ms / 1000.0),
         ultima_mensagem_preview = v_preview,
         ultima_mensagem_direcao = new.direcao,
         nao_lidas = case when new.direcao = 'in' then nao_lidas + 1 else nao_lidas end,
         atualizado_em = now()
   where id = new.lead_id;
  return new;
end; $$;

create trigger trg_mensagens_apos_insert
  after insert on ton.mensagens
  for each row execute function ton.mensagens_apos_insert();

create table ton.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text,
  raw_body jsonb not null,
  headers jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','processed','failed','dead')),
  attempts integer not null default 0,
  last_error text,
  next_retry_at timestamptz not null default now(),
  processed_at timestamptz,
  criado_em timestamptz not null default now()
);

create index webhook_events_status_retry_idx
  on ton.webhook_events (status, next_retry_at) where status in ('pending','failed');

create table ton.eventos_lead (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references ton.leads(id) on delete cascade,
  tipo_evento text not null,
  detalhe jsonb,
  criado_em timestamptz not null default now()
);

create index eventos_lead_lead_idx on ton.eventos_lead (lead_id, criado_em desc);

-- Criada agora, alimentada só quando a fatia do CAPI existir. A Meta NÃO
-- deduplica eventos de business messaging — a deduplicação é nossa.
create table ton.eventos_capi (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references ton.leads(id) on delete cascade,
  nome_evento text not null
    check (nome_evento in ('LeadSubmitted','QualifiedLead','InitiateCheckout','Purchase')),
  event_id text not null unique,
  enviado_em timestamptz,
  status_resposta text,
  criado_em timestamptz not null default now()
);

-- RLS: tudo fechado para anônimo; o operador autenticado enxerga tudo.
-- O service_role (webhook) ignora RLS por definição.
do $$
declare t text;
begin
  foreach t in array array['leads','conversas','mensagens','webhook_events','eventos_lead','eventos_capi']
  loop
    execute format('alter table ton.%I enable row level security', t);
    execute format('grant select, insert, update, delete on ton.%I to authenticated', t);
    execute format('grant all on ton.%I to service_role', t);
    execute format(
      'create policy %I on ton.%I for all to authenticated using (ton.eh_dono()) with check (ton.eh_dono())',
      t || '_operador', t);
  end loop;
end $$;

-- Realtime para o inbox.
alter publication supabase_realtime add table ton.mensagens;
alter publication supabase_realtime add table ton.leads;
alter table ton.mensagens replica identity full;
alter table ton.leads replica identity full;
