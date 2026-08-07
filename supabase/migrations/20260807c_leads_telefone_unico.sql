-- Corrige corrida em `acharOuCriarLead` (Tarefa 9, revisão pós-implementação):
-- select-depois-insert não é atômico. Dois webhooks quase simultâneos do mesmo
-- telefone novo (ex.: "oi" seguido logo depois por outra mensagem) fazem as
-- duas buscas por `telefone_normalizado` falharem (nenhum lead ainda existe) e
-- os dois inserts passarem sem erro, porque o índice antigo não era único —
-- resultado: dois leads para o mesmo telefone. `mensagens` já resolve o mesmo
-- problema com índice único parcial + captura do 23505 no código; `external_id`
-- já tem `unique`. Só faltava `telefone_normalizado`.
--
-- O índice antigo (`leads_telefone_normalizado_idx`, não-único) fica redundante:
-- qualquer índice único cobre as mesmas buscas por igualdade que ele servia, e
-- mantê-los os dois só duplicaria espaço e custo de manutenção em cada insert/update
-- de lead. Por isso ele é removido aqui.

drop index if exists public.leads_telefone_normalizado_idx;

create unique index leads_telefone_normalizado_uniq
  on public.leads (telefone_normalizado) where telefone_normalizado is not null;
