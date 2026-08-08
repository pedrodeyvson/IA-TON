alter table public.leads
  add column if not exists foto_path text;

alter table public.eventos_capi
  add column if not exists payload jsonb,
  add column if not exists resposta jsonb;

insert into storage.buckets (id, name, public)
values ('crm-avatars', 'crm-avatars', false)
on conflict (id) do nothing;

create policy "avatar leitura do operador"
  on storage.objects for select to authenticated
  using (bucket_id = 'crm-avatars' and public.eh_dono());
