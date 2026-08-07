# CRM com IA — Renda Ton (Consultor)

**Data:** 2026-08-07
**Status:** Aprovado para planejamento de implementação

## Contexto e objetivo

Pedro é consultor no programa **Renda Ton** (Stone Co.) — afiliado que indica máquinas de
pagamento (T1, T2, T3, T3 Smart, TapTon, Stone) via link exclusivo e recebe comissão por
venda (~R$590/venda, variável por nível). O suporte pós-venda oficial é da própria Ton
(app/WhatsApp deles); o consultor apenas orienta.

Este projeto constrói um CRM com um agente de IA que atende os leads pelo WhatsApp,
qualifica, tira dúvidas, contorna objeções e conduz até o uso do link de indicação —
funcionando como consultor virtual 24h, com Pedro podendo assumir qualquer conversa a
qualquer momento.

## Decisões fixadas

- **Projeto novo e independente** — não é módulo de CPI, CPI-DMI, FINANCEIRO nem SISTEMA
  EBX. Repositório e infraestrutura (Supabase) próprios.
- **Uso individual** — só Pedro como consultor. Sem multi-tenancy / gestão de equipe.
- **Canal único: WhatsApp via UAZAPI** — instância criada manualmente pelo usuário,
  isolada de qualquer outro projeto (não usa Evolution API, que é o padrão do CPI, para
  não haver risco de conflito de configuração entre projetos).
- **Leads são só inbound** — ninguém é abordado ativamente pela IA; ela só responde quem
  chama. Sem motor de campanha/disparo em massa (alinhado às regras de conduta do
  programa Renda Ton contra spam).
- **Escopo da IA: pré-venda + acompanhamento pós-clique** — qualifica, apresenta solução,
  contorna objeção, envia o link, e depois confirma se o cliente concluiu o cadastro no
  app Ton e tira dúvidas simples. Não substitui o suporte oficial da Ton.
- **Controle humano total** — Pedro pode assumir qualquer conversa a qualquer momento pelo
  inbox; a IA sempre responde primeiro, mas fica pausada numa conversa assumida até ele
  devolver o controle.
- **Base de conhecimento dinâmica** — documentos, PDFs e textos colados alimentam a IA via
  busca semântica (RAG), editável pelo próprio Pedro sem precisar de mudança de código.
- **Integração com Facebook CAPI** — eventos de conversão (`Lead`, `InitiateCheckout`,
  compra confirmada) são enviados de volta para a Meta usando `ctwa_clid` (click-to-
  WhatsApp click id, capturado no payload da primeira mensagem quando o lead vem de
  anúncio), para retroalimentar a otimização das campanhas.
- **Áudio e imagem são tratados nativamente no v1** — áudio transcrito via Groq Whisper
  (mesmo padrão já usado em outro projeto do usuário), imagem processada pela visão
  nativa do Claude. Escalação para humano é reservada a baixa confiança da IA, não ao
  tipo de mídia.

## Arquitetura

**Stack:** TanStack Start (fullstack React) + Supabase (Postgres + Auth + pgvector) +
UAZAPI (WhatsApp) + Anthropic Claude (motor do agente) + shadcn/ui.

```
Cliente no WhatsApp
      │
      ▼
UAZAPI (webhook de mensagem recebida — texto, áudio, imagem, com ctwa_clid se veio de anúncio)
      │
      ▼
Servidor (rota API) ──► grava mensagem no Supabase (idempotente por id da mensagem)
      │  (áudio → transcrição Groq Whisper antes de seguir)
      ▼
Motor da IA (Claude + tools)
  ├─ busca contexto do lead (estágio, histórico, ctwa_clid)
  ├─ busca na base de conhecimento (RAG/pgvector)
  ├─ decide resposta e/ou avança estágio do lead
  ├─ dispara evento correspondente pro Facebook CAPI
      │
      ▼
UAZAPI (envia resposta) ──► Cliente
      │
      ▼
CRM (dashboard/inbox) atualizado em tempo real (Supabase Realtime)
```

**Componentes principais:**
- **Webhook receptor** — recebe mensagens da UAZAPI, idempotente, roteia áudio para
  transcrição antes de processar.
- **Motor do agente** — orquestra a conversa: monta prompt, chama Claude com tools, respeita
  pausa manual por conversa.
- **Base de conhecimento** — documentos indexados em chunks com embeddings, consultados via
  tool de busca semântica.
- **Integração CAPI** — serviço que envia eventos de conversão para a Meta, com
  deduplicação por `event_id`.
- **CRM / Inbox** — leads, conversas ao vivo, base de conhecimento, relatórios.

## Modelo de dados

**`leads`**
`id`, `telefone`, `nome`, `estagio`, `origem`, `maquina_interesse`, `ctwa_clid`,
`utm_source`, `utm_campaign`, `comissao_estimada`, `comissao_confirmada`, `criado_em`,
`atualizado_em`

Estágios: `novo` → `qualificando` → `apresentando_solucao` → `contornando_objecao` →
`link_enviado` → `acompanhamento` → `convertido` / `perdido`.

**`conversas`** (1:1 com lead — sempre WhatsApp)
`id`, `lead_id`, `pausada_pela_ia`, `assumida_em`

**`mensagens`**
`id`, `conversa_id`, `remetente` (`lead` | `ia` | `humano`), `tipo` (`texto` | `audio` |
`imagem`), `conteudo`, `conteudo_transcrito` (para áudio), `criado_em`,
`mensagem_uazapi_id` (idempotência)

**`base_conhecimento`**
`id`, `titulo`, `conteudo`, `tipo`, `ativo`, `criado_em` — com tabela filha de `chunks`
(`documento_id`, `texto`, `embedding`) para a busca semântica.

**`eventos_lead`** (auditoria)
`id`, `lead_id`, `tipo_evento`, `detalhe`, `criado_em`

**`eventos_capi`**
`id`, `lead_id`, `nome_evento` (`Lead` | `InitiateCheckout` | conversão de compra),
`event_id`, `enviado_em`, `status_resposta`

## Fluxo do agente de IA

**Persona:** a IA fala em nome do Pedro, consultor Ton — nunca se apresenta como
funcionária da Ton (regra do programa).

**Tools do Claude:** `buscar_base_conhecimento` (RAG), `consultar_estado_lead`,
`atualizar_estagio_lead`, `registrar_link_enviado` (dispara `InitiateCheckout` no CAPI),
`escalar_para_humano`.

**Guardrails:** nunca promete prazo/valor fora da base de conhecimento; nunca inventa
política da Ton; baixa confiança → oferece escalar em vez de arriscar, especialmente em
perguntas sobre dinheiro/comissão/prazo.

**Pausa/retomada:** com `conversas.pausada_pela_ia = true`, o agente só grava mensagens
recebidas, não responde, até Pedro reativar. Respostas manuais entram em `mensagens` com
`remetente = humano`, mantendo histórico único.

## Inbox e dashboard

- **Lista de conversas** — ordenada por atividade, badge de estágio, indicador "IA
  respondendo" vs "você assumiu".
- **Painel de conversa** — histórico completo, campo de resposta manual (pausa a IA
  automaticamente ao usar), botão "devolver para a IA".
- **Painel do lead** — dados capturados, botão "marcar como convertido" (dispara evento de
  compra no CAPI), campo de valor de comissão.
- **Dashboard** — funil por estágio, taxa de conversão, comissão confirmada no mês, leads
  escalados aguardando atenção.

## Base de conhecimento

Tela "Conhecimento": upload de PDF ou texto colado. Extração → chunking → embedding
processados em background (status "processando" → "pronto"). Documentos podem ser
desativados (não excluídos) sem afetar buscas futuras da IA.

## Tratamento de erros e casos-limite

- **UAZAPI fora do ar / falha ao enviar:** fila com retry e backoff; falha persistente
  escala para o Pedro.
- **Mensagem duplicada (webhook reenviado):** ignorada via `mensagem_uazapi_id`.
- **Baixa confiança da IA:** responde de forma segura e escala, marca lead como "precisa de
  atenção" — independente do tipo de mídia.
- **Áudio:** transcrito via Groq Whisper antes de entrar no fluxo normal do agente.
- **Imagem:** processada pela visão nativa do Claude (comprovantes, prints, fotos de
  máquina) sem etapa separada.
- **Falha ao enviar evento CAPI:** não trava a conversa; registrado em `eventos_capi` com
  status de erro para reenvio.

## Testes

- **Backend:** transições de estágio, idempotência de webhook, deduplicação de eventos
  CAPI, RLS do Supabase.
- **Agente de IA:** golden set de conversas simuladas (FAQs da Renda Ton, objeções comuns,
  casos que devem escalar), rodado a cada mudança de prompt ou base de conhecimento para
  pegar regressão de comportamento.
- **Ponta a ponta manual:** conversa real de teste no WhatsApp, do primeiro contato ao
  envio do link, validando o evento correto no Test Events do Facebook Ads Manager.

## Próximos passos

Plano de implementação detalhado via skill `writing-plans`, decompondo em fatias
incrementais (ex.: fundação + webhook + agente básico → base de conhecimento/RAG → CAPI →
inbox/dashboard completo).
