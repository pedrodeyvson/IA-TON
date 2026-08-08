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

## Decisões revisadas em 07/08/2026 (depois do início da implementação)

Estas substituem o que estiver em conflito nas seções abaixo:

- **Fornecedor de IA: apenas OpenAI.** O spec original propunha Claude para o agente e
  deixava embeddings em aberto. O dono do projeto optou por consolidar num único
  fornecedor — uma fatura, um SDK, uma chave. O agente da Fatia 2 e os embeddings da
  Fatia 3 usam OpenAI. `ANTHROPIC_API_KEY` sai do projeto.
- **Hospedagem: GitHub + EasyPanel** (self-hosted), não Vercel. Implica `Dockerfile`
  próprio e configuração de porta/host — trabalho não previsto no plano da Fatia 1.
- **Webhook da UAZAPI é por instância, NUNCA global.** O servidor UAZAPI hospeda
  instâncias de outros projetos; um webhook global as afetaria todas. A configuração é
  feita no painel da própria instância, apontando para
  `https://<dominio>/api/public/uazapi?secret=<segredo>`. Consequência: o código não usa
  `admintoken` e não expõe função de webhook global.

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
- **Atribuição de anúncio no v1; postback CAPI como fatia futura** — decidido em 07/08/2026
  após pesquisa técnica (ver "Atribuição de anúncios" abaixo). O v1 captura e persiste o
  bloco de anúncio inteiro que a UAZAPI entrega; o envio de conversões de volta para a Meta
  fica para depois, porque depende de duas coisas ainda não resolvidas.
- **Áudio e imagem são tratados nativamente no v1** — áudio transcrito via Groq Whisper
  (mesmo padrão já usado em outro projeto do usuário), imagem processada pela visão
  nativa do Claude. Escalação para humano é reservada a baixa confiança da IA, não ao
  tipo de mídia.

## Atribuição de anúncios (decisão fundamentada)

Pesquisa de 07/08/2026 sobre a UAZAPI e a Conversions API separou dois problemas que
pareciam um só:

**1. Saber qual anúncio gerou o lead — RESOLVIDO.** A UAZAPI repassa o bloco de referral do
protocolo do WhatsApp como passthrough bruto (comportamento **não documentado** na spec
oficial dela, mas verificado em duas integrações de produção independentes) em
`message.content.contextInfo`:

- `externalAdReply.sourceID` — **o ID do anúncio**, casável com o Meta Ads
- `externalAdReply.sourceURL`, `.title`, `.body`, `.sourceApp`, `.sourceType`
- `conversionSource` (`"FB_Ads"`), `entryPointConversionSource` (`"ctwa_ad"` | `"post_cta"`)

⚠️ **Grafia:** `sourceID` e `sourceURL` com maiúsculas (naming do proto whatsmeow) — a
Evolution/Baileys usa `sourceId`/`sourceUrl`. Errar isso dá `undefined` silencioso.
Como é comportamento não documentado, todo acesso usa optional chaining e todo campo é
opcional no banco.

Detecção de lead vindo de anúncio: `if (message.content?.contextInfo?.externalAdReply)`.

**2. Devolver a conversão para a Meta (CAPI) — BLOQUEADO, fatia futura.** Dois motivos:

- **`ctwa_clid` não confirmado.** É a única chave de atribuição que a CAPI aceita. Existe no
  proto (`ExternalAdReplyInfo.ctwaClid`, field 13), mas nenhuma integração UAZAPI conhecida
  o lê e não há payload real público que o comprove. **Teste decisivo pendente:** subir um
  anúncio CTWA, clicar, e logar o `externalAdReply` cru (~R$5, 10 min).
- **Não existe WABA.** A CAPI de mensageria exige um dataset criado via
  `POST /{WHATSAPP_BUSINESS_ACCOUNT_ID}/dataset` e um token com `whatsapp_business_management`
  + `whatsapp_business_manage_events`. WABA só existe na Cloud API oficial da Meta — a UAZAPI
  é não-oficial (protocolo WhatsApp Web) e não tem WABA. Habilitar CAPI exigiria migrar o
  número para a API oficial.

**Consequência para o v1:** o payload de anúncio é capturado e persistido inteiro (incluindo
`ctwa_clid` se vier), o dashboard mostra qual anúncio gerou cada lead e cada comissão, e a
otimização de campanha é manual. Se o teste confirmar o `ctwa_clid` e o número migrar para
WABA, o postback vira uma fatia pequena — os dados já estarão gravados desde o dia 1.

**Especificação da CAPI, para quando a fatia for construída** (documentação oficial da Meta,
verificada; a página está congelada em `v16.0` — usar `v26.0`/`v25.0` é inferência razoável):

- Endpoint: `POST https://graph.facebook.com/v26.0/{DATASET_ID}/events`
- `action_source: "business_messaging"` (**não** `chat`, `website` nem `other`)
- `messaging_channel: "whatsapp"` — campo **de topo do evento**, irmão de `action_source`,
  **não** dentro de `user_data`
- `user_data.ctwa_clid` em **texto puro — nunca hasheado**
- Nomes de evento válidos (lista fechada): `LeadSubmitted`, `QualifiedLead`,
  `InitiateCheckout`, `Purchase`, `AddToCart`, `ViewContent`, `Order*`, `CartAbandoned`,
  `RatingProvided`, `ReviewProvided`. ⚠️ **`Lead` e `Subscribe` NÃO existem** nesse fluxo.
- **A Meta não deduplica** eventos aqui ("we highly encourage advertisers to perform
  deduplication before sending") — a deduplicação é nossa, o que justifica a tabela
  `eventos_capi`.
- `event_time` não pode ter mais de **7 dias**.
- Um evento inválido **rejeita o lote inteiro**; máximo 1.000 eventos por request.

## Arquitetura

**Stack:** TanStack Start + Supabase (Postgres + Auth + pgvector) + UAZAPI (WhatsApp) +
Anthropic Claude (motor do agente) + Groq Whisper (transcrição) + shadcn/ui. Runtime Bun.

```
Cliente no WhatsApp
      │
      ▼
UAZAPI (webhook: texto, áudio, imagem; contextInfo.externalAdReply se veio de anúncio)
      │
      ▼
Rota /api/public/uazapi ──► persiste payload cru em webhook_events
      │                     ──► pré-check de idempotência por provider_message_id
      │  (áudio → Groq Whisper; mídia → Storage)
      ▼
Fila de turnos ──► worker do agente (cron ~1min)
      │
      ▼
Motor da IA (Claude + tools)
  ├─ contexto do lead (estágio, histórico, anúncio de origem)
  ├─ busca na base de conhecimento (RAG/pgvector)
  ├─ decide resposta e/ou avança estágio
      │
      ▼
UAZAPI (envia resposta) ──► Cliente
      │
      ▼
CRM (inbox/dashboard) atualizado via Supabase Realtime
```

**Padrões herdados do CPI** (projeto irmão que já roda UAZAPI + agente de IA em produção —
copiar, não reinventar):

- Convenção `.functions.ts` (vai para o bundle do cliente; só o body do handler é removido —
  nada server-only no topo) vs `.server.ts` (server-only, sempre via `await import()` dentro
  do handler). Segundo o próprio código do CPI, violar isso é a fonte da maioria dos bugs.
- Trio `createServerFn({method:"POST"}).middleware([requireSupabaseAuth, logServerFnErrors])
  .inputValidator(zod.parse).handler(...)`.
- Webhook: `?secret=` fail-closed + payload cru em `webhook_events` antes de processar +
  pré-check de idempotência + índice único parcial + **retorno 500 para o provider
  reentregar**.
- Resolução de `@lid`: o WhatsApp nem sempre traz o telefone real no `remoteJid` — é preciso
  varrer o payload recursivamente atrás de candidatos de identidade.
- Telefone BR: normalização do 9º dígito em TS **e** função `IMMUTABLE` no Postgres, coluna
  gerada por trigger e índice parcial; lookup de lead em níveis.
- Realtime: `postgres_changes` → `invalidateQueries` (nunca aplicar patch no cache);
  `REPLICA IDENTITY FULL` + `ALTER PUBLICATION`.
- RLS: helpers `SECURITY DEFINER STABLE SET search_path = public`; policies `as restrictive`
  quando precisar de segurança em nível de coluna.

**A não repetir do CPI:** nomes de coluna presos a um provider antigo (`evolution_*` para um
provider que não é Evolution). Aqui as colunas nascem neutras: `provider_message_id`,
`whatsapp_connection_id`.

**Componentes principais:**
- **Webhook receptor** — recebe mensagens da UAZAPI, idempotente, roteia áudio para
  transcrição antes de processar, extrai a atribuição de anúncio.
- **Motor do agente** — orquestra a conversa: monta prompt, chama Claude com tools, respeita
  pausa manual por conversa.
- **Base de conhecimento** — documentos indexados em chunks com embeddings, consultados via
  tool de busca semântica.
- **CRM / Inbox** — leads, conversas ao vivo, base de conhecimento, relatórios.

## Modelo de dados

**`leads`**
`id`, `telefone`, `telefone_normalizado` (gerada por trigger), `nome`, `estagio`, `origem`,
`maquina_interesse`, `comissao_estimada`, `comissao_confirmada`, `criado_em`, `atualizado_em`

Atribuição de anúncio (todas opcionais — só preenchidas quando o lead vem de anúncio):
`ad_source_id` (o `sourceID` do `externalAdReply`), `ad_source_url`, `ad_title`,
`ad_source_app`, `ad_conversion_source`, `ctwa_clid` (**se** a UAZAPI o entregar),
`ad_referral_raw` (jsonb com o `contextInfo` inteiro — rede de segurança, já que o formato é
não documentado e pode mudar).

Estágios: `novo` → `qualificando` → `apresentando_solucao` → `contornando_objecao` →
`link_enviado` → `acompanhamento` → `convertido` / `perdido`.

**`conversas`** (1:1 com lead — sempre WhatsApp)
`id`, `lead_id`, `pausada_pela_ia`, `assumida_em`

**`mensagens`**
`id`, `conversa_id`, `remetente` (`lead` | `ia` | `humano`), `tipo` (`texto` | `audio` |
`imagem` | `documento` | `outro`), `conteudo`, `transcricao`, `transcricao_status`,
`media_path`, `media_mime`, `criado_em`, `provider_message_id` (idempotência),
`raw` (jsonb)

Índice único parcial `(provider_message_id) WHERE provider_message_id IS NOT NULL` — é a
segunda camada de idempotência; a primeira é o pré-check no ingest, e o código também trata
o erro `23505` do Postgres como duplicata.

**`webhook_events`** (auditoria de entrega)
`id`, `source`, `event_type`, `raw_body` (jsonb), `headers` (jsonb, com secrets redigidos),
`status` (`pending`|`processing`|`processed`|`failed`|`dead`), `attempts`, `last_error`,
`next_retry_at`, `processed_at`, `criado_em`

**`base_conhecimento`**
`id`, `titulo`, `conteudo`, `tipo`, `ativo`, `criado_em` — com tabela filha de `chunks`
(`documento_id`, `texto`, `embedding`) para a busca semântica.

**`eventos_lead`** (auditoria)
`id`, `lead_id`, `tipo_evento`, `detalhe`, `criado_em`

**`eventos_capi`** — criada no v1 mas **não alimentada** até a fatia do CAPI existir; serve
para a deduplicação que a Meta explicitamente não faz por nós.
`id`, `lead_id`, `nome_evento` (`LeadSubmitted` | `QualifiedLead` | `InitiateCheckout` |
`Purchase`), `event_id`, `enviado_em`, `status_resposta`

## Fluxo do agente de IA

**Persona:** a IA fala em nome do Pedro, consultor Ton — nunca se apresenta como
funcionária da Ton (regra do programa).

**Modelo:** `claude-opus-5` com adaptive thinking (`thinking: {type: "adaptive"}`) e
`output_config.effort`. A API atual rejeita `temperature`/`top_p`/`budget_tokens` e prefill
de turno assistant — o estilo de resposta é controlado por prompt, não por sampling.

**Tools do Claude:** `buscar_base_conhecimento` (RAG), `consultar_estado_lead`,
`atualizar_estagio_lead`, `registrar_link_enviado`, `escalar_para_humano`.

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
- **Painel do lead** — dados capturados, anúncio de origem quando houver, botão "marcar como
  convertido", campo de valor de comissão.
- **Dashboard** — funil por estágio, taxa de conversão, comissão confirmada no mês, leads
  escalados aguardando atenção, e **comissão por anúncio de origem** (`ad_source_id`) — é o
  que substitui a otimização automática enquanto o CAPI não existir.

## Base de conhecimento

Tela "Conhecimento": upload de PDF ou texto colado. Extração → chunking → embedding
processados em background (status "processando" → "pronto"). Documentos podem ser
desativados (não excluídos) sem afetar buscas futuras da IA.

## Tratamento de erros e casos-limite

- **UAZAPI fora do ar / falha ao enviar:** o webhook devolve **500** para o provider
  reentregar (o pré-check de idempotência torna o retry seguro); `webhook_events` guarda
  `attempts`, `last_error` e `next_retry_at`. Falha persistente escala para o Pedro.
- **Mensagem duplicada (webhook reenviado):** pré-check por `provider_message_id` antes de
  qualquer trabalho, mais índice único e tratamento do erro `23505` como duplicata.
- **Lead sem telefone real (`@lid`):** varredura recursiva do payload atrás de candidatos de
  identidade; se ainda assim não houver telefone, o lead é criado com chave
  `external_id = "wa-jid:<jid>"` em vez de ser descartado.
- **Baixa confiança da IA:** responde de forma segura e escala, marca lead como "precisa de
  atenção" — independente do tipo de mídia.
- **Áudio:** transcrito via Groq Whisper (`whisper-large-v3-turbo`, `language: "pt"`) a
  partir do arquivo no Storage. A transcrição **nunca lança** — falha vira
  `transcricao_status = "failed"` e a mensagem segue o fluxo, com retry manual pela UI.
- **Imagem:** processada pela visão nativa do Claude (comprovantes, prints, fotos de
  máquina) sem etapa separada.
- **Campo de anúncio ausente ou renomeado:** todo acesso a `contextInfo` usa optional
  chaining e todos os campos são opcionais — o formato é não documentado e pode mudar sem
  aviso. O `ad_referral_raw` preserva o payload original para reprocessamento.

## Testes

**Ferramenta:** test runner nativo do Node com `node:assert` (mesmo padrão do CPI, ~1000
testes lá). Script desde o dia 1:
`node --test --experimental-strip-types "src/**/*.test.ts"`.

⚠️ Restrição do loader ESM nativo: imports precisam de extensão `.ts` explícita e o alias
`@/` não resolve. Módulos que devem ser testados não podem importar `@/...` no topo — a
lógica pura fica em arquivos sem dependência de alias.

- **Backend:** parsing do webhook (com fixtures de payload real, incluindo um com
  `externalAdReply`), idempotência, normalização de telefone e resolução de `@lid`,
  transições de estágio, RLS do Supabase.
- **Agente de IA:** golden set de conversas simuladas (FAQs da Renda Ton, objeções comuns,
  casos que devem escalar), rodado a cada mudança de prompt ou base de conhecimento para
  pegar regressão de comportamento.
- **Ponta a ponta manual:** conversa real de teste no WhatsApp, do primeiro contato ao
  envio do link.

## Próximos passos

Plano de implementação detalhado via skill `writing-plans`, em fatias incrementais:
fundação + webhook UAZAPI → agente de IA básico → base de conhecimento/RAG →
inbox/dashboard → (futuro, condicionado ao teste) postback CAPI.

**Pendência externa:** teste do anúncio CTWA para confirmar se o `ctwa_clid` chega pela
UAZAPI — decide se a fatia do CAPI é viável sem migrar para a API oficial da Meta.
