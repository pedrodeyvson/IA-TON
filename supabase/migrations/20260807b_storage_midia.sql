insert into storage.buckets (id, name, public)
values ('crm-midia', 'crm-midia', false)
on conflict (id) do nothing;

create policy "midia leitura do operador"
  on storage.objects for select to authenticated
  using (bucket_id = 'crm-midia' and public.eh_dono());
