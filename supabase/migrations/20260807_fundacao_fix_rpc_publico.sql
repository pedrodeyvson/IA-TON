-- Fecha o RPC público exposto pelas funções SECURITY DEFINER da fundação,
-- sinalizado pelo advisor de segurança (0028/0029 anon/authenticated_security_definer_function_executable).
--
-- eh_dono() só precisa ser executável por quem passa pela RLS como authenticated
-- (é usada dentro das policies); não deve ser chamável por anon nem via RPC público.
--
-- mensagens_apos_insert() é função de trigger — nunca deveria ser invocável
-- diretamente por ninguém via /rest/v1/rpc/.

revoke execute on function public.eh_dono() from public;
revoke execute on function public.eh_dono() from anon;
grant execute on function public.eh_dono() to authenticated;

revoke execute on function public.mensagens_apos_insert() from public;
revoke execute on function public.mensagens_apos_insert() from anon;
revoke execute on function public.mensagens_apos_insert() from authenticated;
