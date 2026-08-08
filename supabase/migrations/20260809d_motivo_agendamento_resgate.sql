-- Causa raiz do incidente de 08/08/2026 (17 mensagens da IA para o lead
-- 557187005446 em 60 segundos, a partir de UMA mensagem de entrada).
--
-- `conversas.motivo_agendamento` nasceu em 20260808_agente.sql com
-- `check (motivo_agendamento in ('resposta','followup'))`. A Fatia 6
-- (20260809_fatia6_resgate_e_confirmacao.sql) criou o RESGATE pré-link como uma
-- terceira linha do tempo e `agendarResgate` (src/lib/crm/conversas.server.ts)
-- passou a gravar `motivo_agendamento = 'resgate'` — valor que este check
-- sempre recusou. A mesma migration lembrou do terceiro valor em
-- `turnos_agente.origem` ('resposta_lead','followup','resgate') e esqueceu
-- dele aqui.
--
-- Efeito em produção: TODO agendamento de resgate era rejeitado pelo banco. O
-- supabase-js devolve isso em `{ error }` (não lança), `agendarResgate`
-- ignorava esse campo e respondia `{ agendado: true }`, o turno devolvia
-- `reagendou: true` e o worker soltava só o lock — preservando um
-- `responder_em` que continuava no PASSADO. Três segundos depois o mesmo
-- worker pegava a mesma conversa de novo, e de novo, cada volta enviando uma
-- mensagem de verdade ao cliente.
--
-- Além desta migration, `agendarResposta`/`agendarToque`/`agendarResgate`
-- passaram a checar o `error` do UPDATE (motivo "erro_ao_agendar") e o worker
-- passou a conferir se `responder_em` andou mesmo para o futuro antes de
-- acreditar num `reagendou`.

alter table public.conversas
  drop constraint if exists conversas_motivo_agendamento_check;

alter table public.conversas
  add constraint conversas_motivo_agendamento_check
  check (motivo_agendamento in ('resposta', 'followup', 'resgate'));
