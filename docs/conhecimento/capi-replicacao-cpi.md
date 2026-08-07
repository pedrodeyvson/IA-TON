# CAPI — como o CPI dispara, e o que falta trazer para o TON

Estudo da implementação de referência do CPI (`C:\Users\Pedro Deyvson\Documents\CPI`) e plano de
replicação para o TON-CRM-IA. **Nada foi modificado no CPI e nada foi implementado no TON** — este
documento é só o levantamento e o plano.

Toda afirmação abaixo cita arquivo e linha. Caminhos do CPI são relativos a
`C:\Users\Pedro Deyvson\Documents\CPI\`; os do TON, a `C:\Users\Pedro Deyvson\Documents\TON-CRM-IA\`.

---

## 1. Como o CPI dispara — o fluxo de ponta a ponta

O CPI tem **dois caminhos de disparo**, e eles são deliberadamente diferentes.

### 1.1 Caminho A — `LeadSubmitted` no ingest (síncrono, sem debounce)

`src/lib/uazapi/ingest.ts:860-975`, dentro de `ingerirMensagem`, só para mensagens recebidas
(`if (!fromMe)` — linha 868).

Sequência:

1. Se o lead não é novo (`ingest.ts:874`), relê a linha do lead (`ingest.ts:875-879`) para pegar
   `ctwa_clid`, `capi_lead_submitted_event_id`, `telefone`, `nome`, `source_id`.
2. `leadCtwa = ctwaClid ?? leadRow?.ctwa_clid ?? null` (`ingest.ts:880`) — combina o `ctwa_clid` da
   mensagem atual com o já gravado no lead. É o que torna o disparo **self-healing**: um lead que
   perdeu o disparo se recupera na próxima mensagem recebida (comentário em `ingest.ts:864-867`).
3. `alreadySubmitted = !!leadRow?.capi_lead_submitted_event_id` (`ingest.ts:884`).
4. Gate: `if (leadCtwa && !alreadySubmitted)` (`ingest.ts:943`). **Só dispara com `ctwa_clid`.**
   `source_id` sozinho não dispara — ele só serve para o self-heal de `origem`
   (`ingest.ts:909-915`).
5. `await sendCapiEvent(supabaseAdmin, cfg.organization_id, "LeadSubmitted", {...}, {source_id})`
   (`ingest.ts:945-952`). O `await` é obrigatório e está documentado: em runtime edge/serverless a
   chamada fire-and-forget era descartada ao enviar a resposta HTTP e o evento nunca chegava na Meta
   (`ingest.ts:861-863`).
6. Se `r.skipped` (org sem pixel/token), não registra nada (`ingest.ts:953-954`).
7. Grava o disparo via RPC `append_capi_disparo` (`ingest.ts:955-964`) e, se deu certo, carimba
   `capi_lead_submitted_event_id` no lead (`ingest.ts:965-970`).
8. Tudo dentro de `try/catch` com `console.warn` (`ingest.ts:972-974`) — falha de CAPI nunca custa
   a ingestão da mensagem.

### 1.2 Caminho B — cascata por mudança de etapa (assíncrono, debounce de 2 min + cron)

Ninguém dispara evento no momento em que a etapa muda. Quem muda a etapa só **agenda**:

| Quem move o lead | Onde agenda |
|---|---|
| Kanban / mão humana | `src/lib/crm.functions.ts:613-617` |
| Worker principal da IA | `src/lib/ai-agent/worker.server.ts:1320-1322` |
| Worker de follow-up da IA | `src/lib/ai-agent/followup-worker.server.ts:222-224` |
| Webhook de Lead Ads (edge fn) | `supabase/functions/meta-leadads/index.ts:360` e `:382` |

Os três primeiros chamam `capiFireAfter(ctwa_clid, meta_leadgen_id)`
(`src/lib/meta-capi.constants.ts:52-58`), que devolve `now + 2 min` — ou `undefined` se o lead não
tem **nenhum** identificador de match (sem `ctwa_clid` e sem `meta_leadgen_id` não há o que enviar).
O valor vai para a coluna `crm_leads.capi_fire_after`
(`supabase/migrations/20260713_capi_fire_after.sql`, com índice parcial).

Cada movimento **reseta** o timer. É um debounce: movimentos transitórios (lead que passa por
`qualificado` e cai em `reuniao` em 30 s) são absorvidos, porque o drain recalcula a cascata pela
etapa **assentada**, não pelo caminho percorrido (`src/lib/capi-drain.server.ts:1-2`).

O cron (`supabase/migrations/20260713_capi_drain_cron.sql`) chama
`POST /api/public/hooks/capi-drain` a cada minuto; a rota
(`src/routes/api/public/hooks/capi-drain.ts:12-19`) valida o segredo e chama
`drainPendingCapiFires`.

`drainPendingCapiFires` (`src/lib/capi-drain.server.ts:30-166`):

- Busca até 200 leads com `capi_fire_after <= now()` (`capi-drain.server.ts:43-48`).
- Sem `ctwa_clid` nem `meta_leadgen_id` → limpa o agendamento e pula (`capi-drain.server.ts:57`).
- Lê `organizations.capi_events_enabled` e `ticket_medio_padrao` (`capi-drain.server.ts:59-63`);
  se o toggle estiver `false`, limpa e pula (`capi-drain.server.ts:67`).
- Valor do evento: `valor_estimado` do lead, com fallback para o `ticket_medio_padrao` da org, e
  `undefined` se nenhum dos dois for > 0 (`capi-drain.server.ts:69-71`).
- `ctwa_clid` tem prioridade sobre `meta_leadgen_id` quando (raro) os dois existem
  (`capi-drain.server.ts:73-75`).
- Para cada evento da cascata, envia e grava via `append_capi_disparo`
  (`capi-drain.server.ts:83-116` no ramo CTWA; `:125-151` no ramo Lead Ads).
- No fim, limpa `capi_fire_after` (`capi-drain.server.ts:154`). Se a iteração inteira estourou,
  **não** limpa — o cron tenta de novo no ciclo seguinte (`capi-drain.server.ts:155-158`).

### 1.3 O corpo real enviado à Graph API

Endpoint: `POST https://graph.facebook.com/v21.0/{pixel_id}/events?access_token={token}`
(`src/lib/meta-capi.server.ts:7-8` e `:105`, `:224`), timeout de 15 s
(`meta-capi.server.ts:110`, `:229`).

Credenciais vêm da tabela `organizations` (`meta_pixel_id`, `meta_capi_token`, `meta_page_id`) —
lidas por org a cada envio (`meta-capi.server.ts:175-179`, colunas criadas em
`supabase/migrations/20260708_capi.sql`). Sem pixel ou sem token → `{ ok: false, skipped: true }`
(`meta-capi.server.ts:190-192`).

**Modo business_messaging** (`sendCapiEvent`, `meta-capi.server.ts:157-274`) — payload em
`meta-capi.server.ts:194-217`:

```jsonc
{
  "data": [{
    "event_name": "LeadSubmitted",          // meta-capi.server.ts:196
    "event_time": 1754500000,               // Math.floor(Date.now()/1000)  :197
    "action_source": "business_messaging",  // :199
    "event_id": "<crypto.randomUUID()>",    // :200 (gerado em :171)
    "user_data": {
      "ctwa_clid": "AfeX...",   // TEXTO PURO, nunca hasheado   meta-capi.server.ts:66
      "page_id": "123...",      // userData.page_id || org.meta_page_id  :67-68
      "ph":  "<sha256(só dígitos do telefone)>",   // :69-72
      "fn":  "<sha256(primeiro nome normalizado)>", // :74-75
      "ln":  "<sha256(sobrenomes concatenados SEM espaço)>", // :76
      "external_id": "<sha256(id do lead)>"        // :78-80
    },
    "messaging_channel": "whatsapp",        // :202  — NO NÍVEL DO EVENTO, não em user_data
    "custom_data": {                        // só existe se tiver conteúdo  :216
      "value": 5000,                        // :209-210
      "currency": "BRL",                    // :211 (default "BRL")
      "source_id": "1201..."                // ID do anúncio, informativo   :213-215
    }
  }],
  "test_event_code": "TEST12345"            // só se process.env.META_CAPI_TEST_CODE  :220-222
}
```

Hashing (`meta-capi.server.ts:34-40` para o SHA-256 hex; `:43-50` para a normalização de nome:
`NFD` → remove não-ASCII → minúsculo → só `[a-z\s]` → `trim`). O telefone vira só dígitos antes do
hash (`:70`). O sobrenome é `parts.slice(1).join("")` — **sem separador** (`:76`).

Erro HTTP: mensagem extraída de `parsed?.error?.message` e gravada em `system_logs` com nível
`error`, `organization_id` e um `context` rico (`meta-capi.server.ts:236-258`). Sucesso: log com
`events_received` e `fbtrace_id` (`:263-267`).

**Modo system_generated** (`sendCapiLeadEvent`, `meta-capi.server.ts:286-357`) — para leads de
formulário (Lead Ads), montado em `:320-350`:

- `user_data.lead_id: Number(meta_leadgen_id)` — **não hasheado**, é o identificador direto que a
  Meta usa para casar com o `leadgen_id` do formulário (comentário explícito em `:318-319`).
- `ph` (dígitos), `em` (`trim().toLowerCase()` antes do hash, `:326`), `fn`/`ln` — todos SHA-256.
- `custom_data` fixo: `{ lead_event_source: "CPI CRM", event_source: "crm" }` (`:334-337`), mais
  `value`/`currency` se houver (`:338-341`).
- `action_source: "system_generated"` (`:346`). **Sem `messaging_channel`.**

---

## 2. A cascata no CPI

Duas funções gêmeas, uma por modo. Transcrição literal da versão business_messaging
(`src/lib/meta-capi.constants.ts:117-149`):

```ts
export const FUNNEL_ORDER = ["novo", "qualificado", "reuniao", "venda"] as const;   // :37

export function resolveCascadeEvents(destinationStage: string) {                    // :117
  const destIdx = FUNNEL_ORDER.indexOf(destinationStage as ...);
  if (destIdx < 0) return [];                     // fora do funil => nada          // :121
  const out = [];
  for (let i = 0; i <= destIdx; i++) {            // do início ATÉ o destino        // :123
    const stage = FUNNEL_ORDER[i];
    const event = stage === "novo" ? "LeadSubmitted" : resolveStageEvent(stage);    // :125
    if (event) out.push({ stage, event });
  }
  return out;
}

export function computeEventsToFire(stage, capiDisparos) {                          // :133
  const fired = new Set(
    (capiDisparos ?? [])
      .filter((d) => d.ok === true && d.evento)   // SÓ ok === true conta            // :138
      .map((d) => d.evento),
  );
  const out = [];
  for (const c of resolveCascadeEvents(stage)) {
    if (fired.has(c.event)) continue;             // dedup por NOME de evento        // :144
    fired.add(c.event);                           // e dentro da própria cascata     // :145
    out.push(c);
  }
  return out;
}
```

**O critério, em uma frase:** a partir da **etapa assentada** (nunca do caminho percorrido), a
cascata é o prefixo do funil `novo → qualificado → reuniao → venda` da posição 0 até a etapa de
destino, filtrado pelos que têm evento mapeado, menos os que já saíram com `ok: true`.

Consequências reais, cobertas por teste:

- Lead que pula direto de `novo` para `venda` dispara os 4 eventos, em ordem
  (`meta-capi.constants.test.ts:58-63`).
- Lead que já teve `LeadSubmitted` no ingest só recebe o que falta
  (`meta-capi.constants.test.ts:50-56`).
- Destino fora do funil (`perdido`, `descartado`, nome desconhecido) → `[]`, nada dispara
  (`meta-capi.constants.test.ts:38-42`; `STAGE_EVENT_MAP` mapeia `perdido`/`descartado` para `null`
  em `meta-capi.constants.ts:31-32`).
- **Mover para trás não redispara nada** — a cascata é recalculada e a dedup por nome bloqueia.

A versão Lead Ads (`resolveLeadCascadeEvents` `:82-94`, `computeLeadEventsToFire` `:97-113`) é
byte-a-byte a mesma lógica, só trocando `resolveStageEvent` por `resolveLeadStageEvent` e o
hardcode de `"LeadSubmitted"` pelo `LEAD_STAGE_EVENT_MAP["novo"] = "Lead"`.

---

## 3. A deduplicação no CPI

**Onde mora o estado:** coluna `crm_leads.capi_disparos jsonb DEFAULT '[]'::jsonb`
(`supabase/migrations/20260708_capi.sql`) — um array append-only no próprio lead. Não há tabela
separada.

**Como escreve:** nunca com `update` direto. Sempre pela função
`public.append_capi_disparo(_lead_id uuid, _disparo jsonb)` (`20260708_capi.sql`), que faz
`capi_disparos = COALESCE(capi_disparos,'[]') || _disparo` em `SECURITY DEFINER` — o comentário da
migration diz o porquê: **evita race condition** entre o drain e o ingest escrevendo no mesmo lead.
Chamada em `src/lib/capi-drain.server.ts:102-114` e `:137-149`, e em
`src/lib/uazapi/ingest.ts:964`.

**Formato de cada entrada** (`capi-drain.server.ts:104-113`): `{ evento, event_id, enviado_em,
payload, resposta, ok, erro, etapa }`. O ingest grava o mesmo shape **menos `etapa`**
(`ingest.ts:955-963`) — divergência pequena e inofensiva, mas real.

**Como decide não reenviar:** `computeEventsToFire` monta o `Set` só com `d.ok === true`
(`meta-capi.constants.ts:138`). Portanto:

- Um disparo com `ok: false` **não** conta como enviado e será tentado de novo
  (`meta-capi.constants.test.ts:65-68`).
- A dedup é **por nome de evento**, não por etapa. Duas etapas mapeadas para o mesmo evento geram um
  único disparo.
- A dedup também vale **dentro da mesma cascata** (`fired.add(c.event)` em `:145`), o que impede
  duplicata numa cascata onde dois estágios apontem para o mesmo nome.

**Segunda barreira, só para o `LeadSubmitted`:** a coluna escalar
`crm_leads.capi_lead_submitted_event_id` (`20260708_capi.sql`), lida em `ingest.ts:884` e escrita em
`ingest.ts:965-970`. É o que impede o ingest de redisparar a cada mensagem recebida. O array e a
coluna escalar são dois mecanismos de dedup redundantes para o mesmo evento.

O array é exibido na UI em `src/components/crm/LeadDetailsPanel.tsx:943`.

---

## 4. Os nomes de evento que o CPI usa **de fato** — e a evidência no código

Esta é a seção que importa. Tudo abaixo vem de comentário ou teste **no código do CPI**, não da
documentação da Meta.

### 4.1 Nomes efetivamente enviados

| Modo | Etapa | Nome do evento | Onde |
|---|---|---|---|
| `business_messaging` | `novo` | **`LeadSubmitted`** | hardcode em `meta-capi.constants.ts:125`; enviado em `ingest.ts:949` |
| `business_messaging` | `qualificado` | **`AddToCart`** | `meta-capi.constants.ts:28` |
| `business_messaging` | `reuniao` | **`InitiateCheckout`** | `meta-capi.constants.ts:29` |
| `business_messaging` | `venda` | **`Purchase`** | `meta-capi.constants.ts:30` |
| `system_generated` | `novo` | **`Lead`** | `meta-capi.constants.ts:69` |
| `system_generated` | `qualificado` | **`QualifiedLead`** | `meta-capi.constants.ts:70` |
| `system_generated` | `reuniao` | **`Schedule`** | `meta-capi.constants.ts:71` |
| `system_generated` | `venda` | **`Purchase`** | `meta-capi.constants.ts:72` |

`perdido` e `descartado` são `null` nos dois mapas (`:31-32`, `:73-74`).

### 4.2 O que a Meta **rejeitou** — evidência

`src/lib/meta-capi.constants.ts:1-9`, comentário de topo do arquivo, textual:

> São 14 eventos, e a lista é DIFERENTE dos 17 eventos padrão do Pixel web: `Lead`, `Contact`,
> `Schedule`, `CompleteRegistration` e `SubmitApplication` **NÃO valem aqui — a Meta recusa com
> "Invalid parameter"**.

Isso é o achado mais valioso do CPI inteiro: **`Lead` NÃO é aceito em `action_source:
"business_messaging"`.** É por isso que a etapa `novo` usa `LeadSubmitted` no modo de mensageria e
`Lead` no modo `system_generated` — não é inconsistência, é a Meta tratando os dois `action_source`
com catálogos diferentes.

O teste de guarda em `meta-capi.constants.test.ts:108-118` cristaliza a lista proibida:

```
["Lead", "Contact", "Schedule", "CompleteRegistration", "SubmitApplication",
 "StartTrial", "Subscribe", "AddPaymentInfo", "AddToWishlist", "Search",
 "CustomizeProduct", "Donate", "FindLocation", "DisqualifiedLead"]
```

`DisqualifiedLead` estar nessa lista é resultado de um rollback real — existe
`docs/sessions/2026-07-17-revert-capi-disqualifiedlead-b2b.md` no repositório do CPI.

### 4.3 O que a Meta **aceitou** — evidência

`meta-capi.constants.test.ts:17-22` — a lista oficial de 14 nomes aceitos em business messaging,
mantida como constante de teste:

```
Purchase, LeadSubmitted, InitiateCheckout, AddToCart, ViewContent,
OrderCreated, OrderShipped, OrderDelivered, OrderCanceled, OrderReturned,
CartAbandoned, QualifiedLead, RatingProvided, ReviewProvided
```

**`AddToCart` está confirmadamente no catálogo aceito** (`meta-capi.constants.test.ts:20`, e é o
evento que o CPI usa em produção para `qualificado`, `meta-capi.constants.ts:28`). Isso resolve a
dúvida levantada na spec do TON (`docs/superpowers/specs/2026-08-08-fatia-2-revisao-comercial.md`,
seção 6) sem precisar de spike.

Para o modo `system_generated`, a evidência é ainda mais direta —
`src/lib/meta-capi.server.ts:276-284`, no docblock de `sendCapiLeadEvent`:

> Formato validado contra a API real em 06/08/2026 (evento "Lead", **fbtrace_id
> AH8NYqAzTiyHZSLCYzeq6ZX**).

Repetido em `meta-capi.constants.ts:60-67`, com a conclusão: em `system_generated` **a Meta aceita
nome de evento livre**, definido pelo anunciante.

### 4.4 Inconsistência real no CPI (achado)

`CAPI_AVAILABLE_EVENTS` (`meta-capi.constants.ts:10-15`) tem **13** nomes e **não inclui
`LeadSubmitted`**, enquanto a lista do teste (`meta-capi.constants.test.ts:18-22`) tem **14** e
inclui. O tipo `CapiEventName` (`:17`) remenda isso à mão:
`"LeadSubmitted" | (typeof CAPI_AVAILABLE_EVENTS)[number]`.

Efeito: o teste de guarda `CAPI_AVAILABLE_EVENTS só contém eventos válidos`
(`meta-capi.constants.test.ts:99-106`) **nunca valida `LeadSubmitted`**, que é justamente o evento
mais disparado do sistema. É gambiarra — funciona, mas o teste dá uma sensação de cobertura que ele
não tem. **Não replicar no TON.**

---

## 5. Comparação TON × CPI

### 5.1 Já replicado, fiel

| Item | CPI | TON |
|---|---|---|
| Endpoint e versão da API | `meta-capi.server.ts:7-8` (`v21.0`) | `capi.server.ts:17-18` (`v21.0`) |
| Timeout de 15 s | `meta-capi.server.ts:229` | `capi.server.ts:102` |
| `action_source: business_messaging` | `meta-capi.server.ts:199` | `hash.ts:98` |
| `messaging_channel: whatsapp` no nível do evento | `meta-capi.server.ts:202` | `hash.ts:99` |
| `ctwa_clid` em texto puro | `meta-capi.server.ts:66` | `hash.ts:46` |
| SHA-256 hex via Web Crypto | `meta-capi.server.ts:34-40` | `hash.ts:8-14` |
| Normalização de nome (NFD, ASCII, `[a-z\s]`) | `meta-capi.server.ts:43-50` | `hash.ts:18-25` |
| `ph`/`fn`/`ln`/`external_id` hasheados, sobrenome sem separador | `meta-capi.server.ts:69-80` | `hash.ts:47-58` |
| `custom_data` só se tiver conteúdo; `currency` default `BRL` | `meta-capi.server.ts:207-217` | `hash.ts:103-111` |
| `test_event_code` opcional | `meta-capi.server.ts:220-222` | `hash.ts:114` |
| `skipped` quando falta pixel/token | `meta-capi.server.ts:190-192` | `capi.server.ts:52-58` |
| Best-effort, nunca lança | `meta-capi.server.ts:270-273` | `capi.server.ts:132-144` |
| `await` obrigatório no ingest (nunca fire-and-forget) | `ingest.ts:861-863`, `:946` | `ingest.server.ts:187-189`, `:196` |
| `try/catch` + `console.warn` em volta do disparo | `ingest.ts:972-974` | `ingest.server.ts:207-209` |
| Cascata a partir da etapa de destino | `meta-capi.constants.ts:117-129` | `capi.constants.ts:80-92` |
| Dedup por nome, só sucesso conta | `meta-capi.constants.ts:133-149` | `capi.constants.ts:98-125` |
| Etapa fora do funil → `[]` | `meta-capi.constants.ts:121` | `capi.constants.ts:84` |

### 5.2 Replicado com diferença

| Item | CPI | TON | Diferença |
|---|---|---|---|
| **Estado da dedup** | array jsonb `crm_leads.capi_disparos` + RPC `append_capi_disparo` (`20260708_capi.sql`) | tabela `eventos_capi` (`20260807_fundacao.sql:166-175`) | **Deliberada.** Ver §7. |
| **Onde a dedup é aplicada** | na função pura, antes de enviar (`computeEventsToFire`) | dentro do `enviarEventoCapi`, com `SELECT` no banco (`capi.server.ts:61-71`) | TON faz um round-trip por evento; CPI faz um `SELECT` só por lead. Ver §6.6. |
| **Config** | tabela `organizations` por org (`meta-capi.server.ts:175-179`) | `process.env.META_PIXEL_ID` / `META_CAPI_TOKEN` (`capi.server.ts:52-53`) | **Deliberada.** Uso individual. |
| **`page_id` em `user_data`** | enviado (`meta-capi.server.ts:67-68`) | não existe | **Deliberada.** Sem página/WABA armazenada. |
| **Nomes dos eventos** | `LeadSubmitted`/`AddToCart`/`InitiateCheckout`/`Purchase` | `LeadSubmitted`/`QualifiedLead`/`InitiateCheckout`/`Purchase` (`capi.constants.ts:56-65`, e o check da migration `20260807_fundacao.sql:169-170`) | **A corrigir.** O dono decidiu `Lead`/`AddToCart`/`InitiateCheckout`/`Purchase` (spec §6). Ver §6.1. |
| **Tamanho do funil** | 4 etapas (`meta-capi.constants.ts:37`) | 7 no `ORDEM_FUNIL` (`capi.constants.ts:40-48`) de 8 estágios (`estagios.ts:4-13`), agrupados em 4 colunas de Kanban | **Deliberada.** Ver §7.3. |
| **Gate do disparo no ingest** | só `ctwa_clid` (`ingest.ts:943`) | `ctwaClid \|\| adSourceId` (`ingest.server.ts:192`) | TON dispara também com só `ad_source_id`, sem fabricar `ctwa_clid`. Vai além do CPI — decisão documentada em `.superpowers/sdd/2026-08-07-fatia-1-fundacao-webhook/capi-report.md` §5. Manter. |
| **Registro de erro** | `system_logs` com contexto rico (`meta-capi.server.ts:242-257`) | `eventos_capi.status_resposta` com string `erro:{status}:{msg}` (`capi.server.ts:110`) | TON perde payload e resposta completos. Ver §6.5. |
| **Persistência de payload/resposta** | `payload` e `resposta` inteiros no jsonb (`capi-drain.server.ts:108-109`) | não guarda | Ver §6.5. |

### 5.3 Falta

| Item | Status no TON | Evidência |
|---|---|---|
| **Disparo por mudança de estágio** | **Não existe.** `moverEstagio` (`leads.server.ts:46-62`) grava campos e `eventos_lead`, e não toca em CAPI. `eventosParaDisparar` (`capi.constants.ts:98-110`) **nunca é chamado por nada** fora dos próprios testes | grep por `eventosParaDisparar` só acha `capi.constants.ts` e `capi.constants.test.ts` |
| **Self-healing do `LeadSubmitted`** | Falta. TON só dispara em `alvo.leadNovo` (`ingest.server.ts:192`); CPI redispara em toda mensagem enquanto `!alreadySubmitted` (`ingest.ts:874`, `:943`) | |
| **Valor no `Purchase`** | Falta. `enviarEventoCapi` aceita `value` (`hash.ts:63`), mas nada passa. Colunas `leads.comissao_estimada`/`comissao_confirmada` existem (`20260807_fundacao.sql:38-39`) e não são usadas no CAPI | |
| **Fallback de valor** | Falta. CPI tem `ticket_medio_padrao` (`capi-drain.server.ts:70`); TON não tem o equivalente (`COMISSAO_PADRAO_BRL` é só spec) | |
| **Debounce + cron drain** | Falta inteiro (`capi_fire_after`, `capi-drain`, `pg_cron`) | |
| **Toggle de liga/desliga** | Falta. CPI: `organizations.capi_events_enabled` (`20260708_capi_stage_mapping.sql:3`) | |
| **Retry de evento que falhou** | Falta nos dois — no CPI existe só por acidente. Ver §6.7 | |
| **Caminho Lead Ads (`system_generated`)** | Falta. Provavelmente **não deve** ser replicado — o TON não tem formulário de Lead Ads | |
| **Teste de ponta a ponta ingest→CAPI** | Falta, e o próprio relatório da Fatia 1 admite | `capi-report.md`, "O que ficou sem teste" |

---

## 6. O que trazer para o TON — priorizado

### Melhoria real

**6.1 (P0) Corrigir os nomes de evento e o check da tabela.**
`Lead` **não é aceito** em `business_messaging` — evidência dura em `meta-capi.constants.ts:1-9`
("a Meta recusa com Invalid parameter") e no teste de guarda `meta-capi.constants.test.ts:108-118`.
A spec do TON (§6) manda usar `Lead` para a coluna Novo. **Isso vai quebrar.**

O que a evidência do CPI suporta, mantendo a intenção do dono (eventos padrão do Meta Ads):

| Coluna do Kanban | Estágios internos | Evento — recomendado | Justificativa |
|---|---|---|---|
| Novo | `novo`, `qualificando` | **`LeadSubmitted`** (não `Lead`) | `Lead` é recusado em business_messaging (`meta-capi.constants.ts:4-5`); `LeadSubmitted` é o que o CPI dispara em produção (`ingest.ts:949`) |
| Qualificado | `apresentando_solucao`, `contornando_objecao` | **`AddToCart`** | confirmado no catálogo aceito (`meta-capi.constants.test.ts:20`) e em produção no CPI (`meta-capi.constants.ts:28`) |
| Interesse | `link_enviado`, `acompanhamento` | **`InitiateCheckout`** | `meta-capi.constants.ts:29` |
| Venda | `convertido` | **`Purchase`** | `meta-capi.constants.ts:30` |

Ou seja: das duas trocas que a spec pede, **`QualifiedLead` → `AddToCart` está certa e deve ser
feita; `LeadSubmitted` → `Lead` está errada e deve ser abandonada.** Levar isso ao dono antes de
implementar — é uma correção factual sobre o que a Meta aceita, não preferência de estilo.

A migration precisa alterar o check de `eventos_capi.nome_evento`
(`20260807_fundacao.sql:169-170`) de
`('LeadSubmitted','QualifiedLead','InitiateCheckout','Purchase')` para
`('LeadSubmitted','AddToCart','InitiateCheckout','Purchase')`, e o `ESTAGIO_EVENTO_MAP`
(`capi.constants.ts:56-65`) precisa passar a mapear `apresentando_solucao` e `contornando_objecao`
para `AddToCart` em vez de `null`.

**6.2 (P0) Ligar a cascata ao `moverEstagio`.**
Hoje `eventosParaDisparar` é código morto. A spec (§6) já decidiu certo: o disparo mora **dentro de
`moverEstagio`** (`leads.server.ts:46-62`), um lugar só. Padrão a copiar do CPI: buscar os nomes já
enviados com sucesso, chamar `eventosParaDisparar(novoEstagio, jaEnviados)` e enviar em ordem, tudo
em `try/catch` (`capi-drain.server.ts:83-116`). Sem isso, três dos quatro eventos nunca saem.

**6.3 (P1) `value` + `currency: "BRL"` no `Purchase`.**
Copiar a regra exata do CPI (`capi-drain.server.ts:88-92`), que é mais cuidadosa do que parece:

```ts
if (eventValue != null) customData.value = eventValue;
// A Meta exige currency sempre que value é enviado. Purchase leva currency
// mesmo sem value, por ser o evento monetário do fim do funil.
if (eventValue != null || event === "Purchase") customData.currency = "BRL";
```

No TON o valor é `leads.comissao_estimada` (`20260807_fundacao.sql:38`) com fallback para
`COMISSAO_PADRAO_BRL` — mesma forma do `valor_estimado` → `ticket_medio_padrao` do CPI
(`capi-drain.server.ts:69-71`).

**6.4 (P1) Self-healing do `LeadSubmitted` no ingest.**
O CPI dispara em **toda** mensagem recebida enquanto o lead não tiver o evento registrado
(`ingest.ts:874`, `:880`, `:943`), e combina o `ctwa_clid` da mensagem atual com o do lead. O TON só
dispara em `leadNovo` (`ingest.server.ts:192`) — um lead cujo disparo falhou por timeout da Meta
fica órfão para sempre. **A abordagem do CPI é superior aqui**, e o custo de adotá-la é baixo: a
dedup do TON já bloqueia o reenvio (`capi.server.ts:61-71`), então basta afrouxar o gate de
`alvo.leadNovo` para "lead com atribuição que ainda não tem `LeadSubmitted` com `status_resposta =
'ok'`". O próprio `capi-report.md` §6 registra essa lacuna como consciente e temporária.

**6.5 (P2) Guardar payload e resposta do envio.**
CPI grava `payload` e `resposta` inteiros no jsonb (`capi-drain.server.ts:108-109`,
`ingest.ts:959-960`) e ainda escreve em `system_logs` com contexto rico
(`meta-capi.server.ts:242-257`). TON só guarda `status_resposta` como string truncada em 200 chars
(`capi.server.ts:110`). **A abordagem do CPI é superior**: quando a Meta recusa um evento, a mensagem
de erro dela é a única fonte de diagnóstico, e 200 caracteres cortam o `fbtrace_id`. Recomendação
para o TON: duas colunas `jsonb` (`payload`, `resposta`) em `eventos_capi`, mais `fbtrace_id` como
coluna própria — é o que se cita ao abrir ticket com a Meta.

**6.6 (P2) Fazer a dedup ler uma vez por lead, não uma por evento.**
Hoje o TON faz um `SELECT` em `eventos_capi` dentro de `enviarEventoCapi`
(`capi.server.ts:61-65`), filtrado por `nome_evento`. Numa cascata de 4 eventos isso vira 4
`SELECT`s + 4 `INSERT`s. O CPI lê `capi_disparos` uma vez junto com o lead
(`capi-drain.server.ts:45`) e resolve tudo na função pura. **A forma do CPI é superior em desenho**
(a decisão de dedup fica em lógica pura e testável, o I/O em um lugar só), e no TON dá para ter as
duas coisas: `eventosParaDisparar` decide a partir de uma leitura única, e o `jaFoiEnviado` de
dentro do `enviarEventoCapi` (`capi.server.ts:69`) fica como rede de segurança contra corrida.

**6.7 (P2) Retry de evento que falhou — fazer melhor que o CPI.**
No CPI, um evento com `ok: false` fica pendente na prática mas **nada o reagenda**:
`clearFireAfter` roda no fim de toda iteração bem-sucedida (`capi-drain.server.ts:154`), e só uma
nova mudança de etapa reescreve `capi_fire_after` (`crm.functions.ts:613-617`). Um `Purchase` que
falhou por rate limit fica órfão até o lead se mover de novo — o que, em `venda`, nunca acontece.
**Isto é um bug real do CPI.** O TON não deve copiar: quando o envio falha por erro transitório
(HTTP 429/5xx/timeout), reagendar ou deixar o próximo `moverEstagio` recuperar — e, no mínimo,
deixar visível na UI que existe evento pendente.

### Só diferença de estilo — não replicar

- **`postCapiEvent` extraído mas não usado por `sendCapiEvent`.** `meta-capi.server.ts:90-151` é um
  helper genérico que só `sendCapiLeadEvent` usa (`:352`); `sendCapiEvent` mantém uma cópia inline
  de todo o bloco de fetch/erro/log (`:224-273`). Refatoração pela metade — os dois caminhos podem
  divergir em silêncio. O TON já está melhor: `montarPayloadEvento` (`hash.ts:86-116`) é puro e
  único.
- **`page_id: ""` nos dois call sites.** `capi-drain.server.ts:97` e `ingest.ts:950` sempre passam
  string vazia, o que faz o parâmetro sempre cair no fallback `org.meta_page_id`
  (`meta-capi.server.ts:188`). Parâmetro morto. Não replicar.
- **`capi_qualified_event_id` e `capi_purchase_event_id`.** Criadas em `20260708_capi.sql`, aparecem
  nos tipos gerados (`src/integrations/supabase/types.ts:1650-1651`) e **nenhum código escreve
  nelas** — só `capi_lead_submitted_event_id` é usada (`ingest.ts:968`). Colunas mortas de um design
  anterior à cascata. Não replicar.
- **`capiFireAfter` duplicado na edge function.** `supabase/functions/meta-leadads/index.ts:138-142`
  reimplementa `capiFireAfterTimestamp()` porque Deno não importa de `src/`. Justificável no CPI;
  irrelevante no TON.
- **Divergência de shape no `capi_disparos`.** O drain grava `etapa`
  (`capi-drain.server.ts:112`), o ingest não (`ingest.ts:955-963`). Consumidores precisam tolerar a
  ausência. No TON, `eventos_capi` tem esquema fixo — problema que não existe.
- **`capi_events_enabled`.** Toggle por org (`20260708_capi_stage_mapping.sql:3`,
  `capi-drain.server.ts:67`). Num sistema de uso individual, a ausência de `META_PIXEL_ID` já é o
  liga/desliga (`capi.server.ts:56-58`). Não precisa de coluna.

### Achado de drift no CPI (não é para replicar, é para não repetir)

`supabase/migrations/20260713_capi_drain_cron.sql` agenda o cron mandando só o header `apikey` com
a publishable key hardcoded. Mas a rota `src/routes/api/public/hooks/capi-drain.ts:13` exige
`x-hooks-secret` desde a auditoria de segurança de 04/08/2026
(`src/lib/hooks-auth.server.ts:1-6`, `:16-18`). **A migration nunca foi atualizada** — o job no
banco provavelmente foi reagendado à mão, e o repositório não descreve mais o que está rodando.
Além disso, uma chave está commitada no SQL. Se o TON adotar cron, a configuração tem que vir de
`vault`/env, não de literal em migration.

---

## 7. Divergências deliberadas que devem permanecer

### 7.1 Sem organizações, sem multi-tenancy

Todo o CPI carrega `orgId` como primeiro parâmetro de negócio (`meta-capi.server.ts:158`,
`capi-drain.server.ts:60`, `ingest.ts:948`) e lê pixel/token da tabela `organizations`
(`meta-capi.server.ts:175-179`). O TON lê de `process.env` (`capi.server.ts:52-53`).

**Onde isso muda a replicação:**

- Nenhuma função do TON deve ganhar parâmetro de org. A assinatura
  `enviarEventoCapi(admin, leadId, eventName, dadosUsuario, dadosCustom)` (`capi.server.ts:45-51`)
  já está certa e não deve mudar.
- O toggle `capi_events_enabled` não é portado (§6, "estilo").
- `ticket_medio_padrao` da org (`capi-drain.server.ts:70`) vira variável de ambiente
  (`COMISSAO_PADRAO_BRL`).
- `system_logs` do CPI é `organization_id`-scoped (`meta-capi.server.ts:246`); no TON o equivalente
  são colunas em `eventos_capi` (§6.5), sem escopo.
- O modo `system_generated`/Lead Ads (`sendCapiLeadEvent`, `meta-capi.server.ts:286-357`,
  `LEAD_STAGE_EVENT_MAP` `meta-capi.constants.ts:68-75`, edge function `meta-leadads`) **não deve
  ser portado**: o TON não tem formulário de Lead Ads e não tem `meta_leadgen_id`. Toda a bifurcação
  do drain (`capi-drain.server.ts:73-152`) desaparece, e com ela metade da complexidade.

### 7.2 Dedup em tabela (`eventos_capi`), não em jsonb no lead

**Onde isso muda a replicação:**

- **`append_capi_disparo` não é portado.** A RPC existe no CPI (`20260708_capi.sql`) para evitar
  race condition no append ao array. Um `INSERT` numa tabela já é atômico — o problema não existe.
  A garantia forte vem de graça: `eventos_capi.event_id text not null unique`
  (`20260807_fundacao.sql:171`).
- **Recomendação:** acrescentar `unique (lead_id, nome_evento) where status_resposta = 'ok'` como
  índice parcial. Isso transforma a dedup de convenção de aplicação (que é o que o CPI tem — nada
  no banco impede dois `Purchase` no array) em invariante do banco. **Ponto em que o TON pode ser
  superior ao CPI**, e barato.
- A assinatura de `eventosParaDisparar` já reflete a diferença corretamente: recebe
  `string[]` de nomes (`capi.constants.ts:98-101`), enquanto o CPI recebe
  `Array<{evento, ok}>` (`meta-capi.constants.ts:133-135`) porque precisa filtrar o array bruto.
  **Manter.** A filtragem de `status_resposta === "ok"` fica no `jaFoiEnviado`
  (`capi.constants.ts:118-125`), que é o análogo correto do `.filter(d => d.ok === true)` do CPI
  (`meta-capi.constants.ts:138`).
- Não replicar a coluna escalar redundante `capi_lead_submitted_event_id` (`20260708_capi.sql`,
  usada em `ingest.ts:884`/`:968`). Ela existe no CPI porque consultar dentro de um array jsonb é
  caro; no TON um `SELECT` em `eventos_capi` já resolve. Duas fontes de verdade para o mesmo fato é
  passivo.
- Custo consciente: o TON precisa de um round-trip a mais por cascata (§6.6). É o preço de ter o
  estado em tabela — e vale, porque `eventos_capi` é auditável, indexável e não cresce dentro da
  linha do lead.

### 7.3 Funil de 8 estágios agrupado em 4 colunas, não 4 etapas

CPI: `FUNNEL_ORDER = ["novo","qualificado","reuniao","venda"]`
(`meta-capi.constants.ts:37`) — etapa e coluna são a mesma coisa.

TON: 8 estágios internos (`estagios.ts:4-13`), `ORDEM_FUNIL` com 7 deles
(`capi.constants.ts:40-48`, `perdido` fora), agrupados em 4 colunas de Kanban pela spec (§6).

**Onde isso muda a replicação:**

- `ESTAGIO_EVENTO_MAP` é **N:1**, não 1:1 — dois estágios apontam para o mesmo evento
  (`apresentando_solucao` e `contornando_objecao` → `AddToCart`; `link_enviado` e `acompanhamento` →
  `InitiateCheckout`). A dedup por **nome de evento** do CPI (`meta-capi.constants.ts:144-145`) já
  cobre isso corretamente e é o que faz o desenho funcionar: um lead que vai e volta entre
  `apresentando_solucao` e `contornando_objecao` gera **um** `AddToCart`. Confirmado no TON em
  `capi.constants.ts:105-107`, que já usa a mesma estratégia. **Não mexer.**
- `ORDEM_FUNIL` do TON precisa continuar sendo a ordem **completa dos 7 estágios**, não das 4
  colunas — a cascata percorre o índice do array (`capi.constants.ts:86-90`) e um mapeamento por
  coluna quebraria o cálculo de prefixo para estágios intermediários.
- `camposDeTransicao` (`estagios.ts:35-61`) já trata retrocesso limpando marcos. Retroceder **não**
  pode redisparar evento — a dedup garante, mas vale um teste explícito (o CPI tem o equivalente em
  `meta-capi.constants.test.ts:70-78`).
- Como o TON dispara síncrono dentro de `moverEstagio` (§6.2), e não via cron sobre a etapa
  assentada, ele perde a absorção de movimentos transitórios que o debounce do CPI dá
  (`capi-drain.server.ts:1-2`). Na prática isso importa pouco: a dedup por nome já impede
  duplicata, e o pior caso é um `AddToCart` disparado num lead que segundos depois volta para
  `qualificando` — sinal ligeiramente prematuro, não duplicado. **Aceitável para uso individual**;
  não vale importar `pg_cron` + `pg_net` + endpoint público + segredo de hook por causa disso.

---

## Resumo executável (ordem sugerida)

1. Migration: check de `eventos_capi.nome_evento` → `('LeadSubmitted','AddToCart','InitiateCheckout','Purchase')`; colunas `payload jsonb`, `resposta jsonb`, `fbtrace_id text`; índice parcial único `(lead_id, nome_evento) where status_resposta = 'ok'`.
2. `capi.constants.ts`: `ESTAGIO_EVENTO_MAP` com `AddToCart` em `apresentando_solucao` e `contornando_objecao`; `EVENTOS_CAPI_VALIDOS` alinhado. Manter `LeadSubmitted` em `novo` — **não** trocar por `Lead`.
3. `moverEstagio`: ler nomes já enviados, `eventosParaDisparar`, enviar em ordem, `try/catch`, `value`+`currency` no `Purchase`.
4. Ingest: afrouxar o gate de `leadNovo` para self-healing.
5. Testes: retrocesso não redispara; cascata `novo → convertido` dispara os 4; `Purchase` sem comissão usa `COMISSAO_PADRAO_BRL`; teste de fio condutor `webhook → ingest → enviarEventoCapi`.
6. Validação em produção: conferir os 4 nomes em `eventos_capi` com `status_resposta = 'ok'` e o `fbtrace_id` de cada um.
