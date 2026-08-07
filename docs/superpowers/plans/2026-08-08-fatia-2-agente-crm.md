# Fatia 2 — Camada CRM + Agente de IA — Plano de Implementação

> **Para trabalhadores agênticos:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Fazer o sistema responder — o lead manda mensagem no WhatsApp e recebe de volta
uma resposta do agente de IA, que qualifica, envia o link de indicação na hora certa, escala
para o Pedro quando não deve arriscar e faz um follow-up 24h depois.

**Arquitetura:** O webhook (Fatia 1) só grava e agenda; um loop in-process no `server.ts`
acorda a cada 3s, pega conversas com agendamento vencido, aplica um lock por UPDATE atômico e
roda o turno do agente. A lógica de CRM fica em módulos que recebem o client `admin` por
parâmetro — mesmo formato de `ingerirEvento(admin, body)` — para serem testáveis sem HTTP e
sem autenticação; as `createServerFn` com `requireSupabaseAuth` entram só na Fatia 4.

**Stack:** TanStack Start 1.168, Supabase JS, Bun em produção, `node --test` para testes,
OpenAI via `fetch` puro (sem SDK — mesmo padrão de `capi.server.ts` e `groq-transcribe.server.ts`).

**Spec:** `docs/superpowers/specs/2026-08-08-fatia-2-agente-crm-design.md`

## Restrições globais

- **Idioma:** todo identificador, comentário e mensagem de commit em português. É o padrão do
  repositório inteiro.
- **Loader ESM nativo:** todo import em módulo testado precisa de extensão `.ts` explícita
  (`from "./estagios.ts"`), e o alias `@/` **não resolve**. Módulos testáveis nunca importam
  `@/...` no topo — use import dinâmico dentro da função, como o `ingest.server.ts` já faz.
- **Suíte de testes:** `npm test` roda
  `node --test --experimental-strip-types "src/**/*.test.ts"`. Só arquivos `*.test.ts` são
  coletados; helpers de teste têm outro sufixo.
- **`admin` por parâmetro:** nenhum módulo de `src/lib/crm/` ou `src/lib/agente/` cria o
  client Supabase. Ele chega como primeiro argumento, tipado `any` (padrão já usado no
  `ingest.server.ts`).
- **Nunca lançar no caminho da mensagem:** falha de CAPI, de mídia, de transcrição ou do
  agente jamais pode derrubar o processamento de uma mensagem. `try/catch` + `console.warn`,
  como já se faz no `ingest.server.ts`.
- **O modelo nunca escreve o link.** `TON_LINK_INDICACAO` só sai pela tool
  `registrar_link_enviado`; o link não entra no system prompt.
- **Taxa nunca é respondida.** Nenhum número de taxa em nenhum arquivo de conhecimento.
- **Sem dependência nova no `package.json`.** OpenAI é `fetch`.
- **Commits frequentes**, um por tarefa no mínimo, sempre em português.

**Variáveis de ambiente novas** (adicionar ao `.env` local e ao EasyPanel):

```
OPENAI_MODEL=gpt-5.4-mini
TON_LINK_INDICACAO=<pendente do dono>
AGENTE_ATIVO=true
AGENTE_DEBOUNCE_MS=8000
FOLLOWUP_HORAS=24
```

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `supabase/migrations/20260808_agente.sql` | Colunas de agendamento, status de mensagem, tabela `tarefas` | 1 |
| `src/lib/crm/estagios.ts` | Ordem, transições e carimbo de data. **Puro** | 2 |
| `src/lib/crm/admin-fake.ts` | Fake do query builder do Supabase para testes. Não é `.test.ts` | 3 |
| `src/lib/crm/leads.server.ts` | Ler e escrever lead, mover estágio, escalar, nota | 3 |
| `src/lib/crm/conversas.server.ts` | Agendar, travar, pausar/retomar, marcar lida | 4 |
| `src/lib/crm/mensagens.server.ts` | Listar histórico e enviar texto (grava → envia → confirma) | 5 |
| `src/lib/crm/tarefas.server.ts` | Lembretes manuais, molde do `crm_tasks` do CPI | 6 |
| `src/lib/uazapi/ingest.server.ts` | **Modificar:** agendar resposta ao gravar mensagem do lead | 7 |
| `src/lib/agente/fixtures/openai-tool-call.json` | Resposta real capturada da OpenAI | 8 |
| `src/lib/agente/openai.server.ts` | Cliente HTTP da OpenAI com tool calling | 9 |
| `src/lib/agente/conhecimento.ts` | FAQ curada da Renda Ton. **Puro** | 10 |
| `src/lib/agente/prompt.ts` | Monta o system prompt. **Puro** | 10 |
| `src/lib/agente/politica.ts` | Decide se responde e monta a janela de histórico. **Puro** | 11 |
| `src/lib/agente/tools.ts` | Definição e execução das tools | 12 |
| `src/lib/agente/agente.server.ts` | O turno completo | 13 |
| `src/lib/worker/loop.server.ts` | O `setInterval`, o lock e o backoff | 14 |
| `server.ts` | **Modificar:** liga o loop | 14 |
| `src/lib/agente/golden.test.ts` | Golden set atrás de `AGENTE_GOLDEN=1` | 16 |

---

## Task 1: Migração do banco

**Arquivos:**
- Criar: `supabase/migrations/20260808_agente.sql`

**Interfaces:**
- Consome: schema da Fatia 1 (`leads`, `conversas`, `mensagens`, `eventos_lead`)
- Produz: colunas `conversas.responder_em`, `conversas.motivo_agendamento`,
  `conversas.processando_em`, `conversas.tentativas`, `conversas.ultimo_erro`,
  `conversas.followup_enviado`; `mensagens.status`; `leads.estagio_alterado_em`,
  `leads.link_enviado_em`, `leads.motivo_perdido`; tabela `tarefas`

- [ ] **Passo 1: Escrever a migração**

```sql
-- Fatia 2: agendamento do agente, status de envio e tarefas manuais.

-- ===================== CONVERSAS: agendamento e lock =====================
-- responder_em null = nada pendente. O worker varre por esta coluna a cada 3s,
-- então o índice é parcial: só as conversas com algo agendado entram nele.
alter table public.conversas
  add column responder_em timestamptz,
  add column motivo_agendamento text
    check (motivo_agendamento in ('resposta','followup')),
  add column processando_em timestamptz,
  add column tentativas integer not null default 0,
  add column ultimo_erro text,
  add column followup_enviado boolean not null default false;

create index conversas_responder_em_idx
  on public.conversas (responder_em)
  where responder_em is not null;

-- ===================== MENSAGENS: status de envio =====================
-- A mensagem da IA é gravada ANTES do envio. Assim nada que o lead recebeu
-- fica fora do histórico, e nada que falhou some sem rastro.
-- Mensagem recebida (direcao='in') nasce 'enviada': não há envio a fazer.
alter table public.mensagens
  add column status text not null default 'enviada'
    check (status in ('pendente','enviada','falhou'));

-- ===================== LEADS: datas do funil =====================
-- O CPI usa uma coluna de data por etapa, mas lá são 5 estágios e aqui são 8.
-- O histórico completo de transições fica em eventos_lead; só as datas que o
-- dashboard da Fatia 4 realmente consulta viram coluna.
alter table public.leads
  add column estagio_alterado_em timestamptz,
  add column link_enviado_em timestamptz,
  add column motivo_perdido text;

-- ===================== TAREFAS =====================
-- Molde do crm_tasks do CPI, sem a parte de multi-tenancy (uso individual).
-- São os lembretes que o Pedro cria à mão — a IA nunca escreve aqui.
create table public.tarefas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  titulo text not null,
  descricao text,
  prazo timestamptz,
  concluida boolean not null default false,
  concluida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index tarefas_pendentes_idx on public.tarefas (concluida, prazo);
create index tarefas_lead_idx on public.tarefas (lead_id);

alter table public.tarefas enable row level security;

-- Mesma política das demais tabelas da Fatia 1: uso individual, quem está
-- autenticado vê tudo. O service role do servidor ignora RLS.
create policy tarefas_autenticado on public.tarefas
  for all using (public.eh_autenticado()) with check (public.eh_autenticado());
```

- [ ] **Passo 2: Conferir o nome da função de RLS**

A política acima usa `public.eh_autenticado()`. Rode:

```bash
grep -n "create or replace function public\." supabase/migrations/20260807_fundacao.sql
```

Se a função tiver outro nome, corrija a política para o nome real **antes** de aplicar. Se
as tabelas da Fatia 1 usarem outra forma de policy, copie a forma delas:

```bash
grep -n "create policy" supabase/migrations/20260807_fundacao.sql
```

- [ ] **Passo 3: Aplicar no Supabase**

Aplique via MCP do Supabase (`apply_migration`, projeto `fqnvwrhetpnwsxqfwxnf`, nome
`20260808_agente`) ou colando no SQL Editor.

- [ ] **Passo 4: Verificar que aplicou**

```sql
select column_name from information_schema.columns
 where table_name = 'conversas' and column_name in
   ('responder_em','motivo_agendamento','processando_em','tentativas','ultimo_erro','followup_enviado');
select column_name from information_schema.columns
 where table_name = 'mensagens' and column_name = 'status';
select count(*) from public.tarefas;
```

Esperado: 6 linhas, 1 linha, e `0` sem erro.

- [ ] **Passo 5: Regenerar os tipos**

```bash
npx supabase gen types typescript --project-id fqnvwrhetpnwsxqfwxnf > src/integrations/supabase/types.ts
```

Se o comando não estiver disponível, use o MCP `generate_typescript_types` e grave a saída no
mesmo arquivo.

- [ ] **Passo 6: Commit**

```bash
git add supabase/migrations/20260808_agente.sql src/integrations/supabase/types.ts
git commit -m "feat(db): agendamento do agente, status de mensagem e tabela tarefas"
```

---

## Task 2: Estágios do funil (puro)

**Arquivos:**
- Criar: `src/lib/crm/estagios.ts`
- Testar: `src/lib/crm/estagios.test.ts`

**Interfaces:**
- Consome: nada
- Produz:
  - `type Estagio` — union dos 8 estágios
  - `ESTAGIOS: readonly Estagio[]`
  - `ehEstagio(valor: unknown): valor is Estagio`
  - `ordemEstagio(e: Estagio): number`
  - `camposDeTransicao(de: Estagio, para: Estagio, agoraIso: string): Record<string, unknown>`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/crm/estagios.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ESTAGIOS, ehEstagio, ordemEstagio, camposDeTransicao } from "./estagios.ts";

const AGORA = "2026-08-08T12:00:00.000Z";

test("conhece exatamente os 8 estágios do check do banco", () => {
  assert.deepEqual(ESTAGIOS, [
    "novo", "qualificando", "apresentando_solucao", "contornando_objecao",
    "link_enviado", "acompanhamento", "convertido", "perdido",
  ]);
});

test("ehEstagio aceita válido e rejeita inventado", () => {
  assert.equal(ehEstagio("link_enviado"), true);
  assert.equal(ehEstagio("negociando"), false);
  assert.equal(ehEstagio(null), false);
  assert.equal(ehEstagio(3), false);
});

test("ordem cresce ao longo do funil e os terminais ficam por último", () => {
  assert.ok(ordemEstagio("novo") < ordemEstagio("qualificando"));
  assert.ok(ordemEstagio("link_enviado") < ordemEstagio("acompanhamento"));
  assert.ok(ordemEstagio("acompanhamento") < ordemEstagio("convertido"));
});

test("transição carimba estagio e estagio_alterado_em", () => {
  const campos = camposDeTransicao("novo", "qualificando", AGORA);
  assert.equal(campos.estagio, "qualificando");
  assert.equal(campos.estagio_alterado_em, AGORA);
});

test("entrar em link_enviado carimba link_enviado_em", () => {
  const campos = camposDeTransicao("apresentando_solucao", "link_enviado", AGORA);
  assert.equal(campos.link_enviado_em, AGORA);
});

test("acompanhamento não recarimba link_enviado_em", () => {
  // O lead já passou por link_enviado; a data original tem que sobreviver.
  const campos = camposDeTransicao("link_enviado", "acompanhamento", AGORA);
  assert.equal("link_enviado_em" in campos, false);
});

test("voltar de link_enviado limpa link_enviado_em", () => {
  // Se o funil retrocedeu, o dashboard não pode continuar contando o link.
  const campos = camposDeTransicao("link_enviado", "qualificando", AGORA);
  assert.equal(campos.link_enviado_em, null);
});

test("sair de perdido limpa motivo_perdido", () => {
  const campos = camposDeTransicao("perdido", "qualificando", AGORA);
  assert.equal(campos.motivo_perdido, null);
});

test("transição para o mesmo estágio não devolve nada", () => {
  assert.deepEqual(camposDeTransicao("novo", "novo", AGORA), {});
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
npx tsx --test src/lib/crm/estagios.test.ts 2>/dev/null || node --test --experimental-strip-types src/lib/crm/estagios.test.ts
```

Esperado: FALHA com "Cannot find module './estagios.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/crm/estagios.ts`:

```ts
// Puro: sem banco, sem env, sem import de alias. Espelha o check de
// public.leads.estagio — se o check mudar no banco, muda aqui junto.

export const ESTAGIOS = [
  "novo",
  "qualificando",
  "apresentando_solucao",
  "contornando_objecao",
  "link_enviado",
  "acompanhamento",
  "convertido",
  "perdido",
] as const;

export type Estagio = (typeof ESTAGIOS)[number];

export function ehEstagio(valor: unknown): valor is Estagio {
  return typeof valor === "string" && (ESTAGIOS as readonly string[]).includes(valor);
}

export function ordemEstagio(e: Estagio): number {
  return ESTAGIOS.indexOf(e);
}

/**
 * Campos a gravar no lead quando ele muda de estágio.
 *
 * Ao contrário do CPI, aqui não há uma coluna de data por etapa (são 8
 * estágios, não 5) — o histórico completo vive em eventos_lead. Só as datas
 * que o dashboard consulta viram coluna, e elas seguem duas regras:
 *  - carimba ao ENTRAR no estágio, uma vez;
 *  - limpa ao RETROCEDER para antes dele, para o dashboard não contar um
 *    marco que deixou de valer.
 */
export function camposDeTransicao(
  de: Estagio,
  para: Estagio,
  agoraIso: string,
): Record<string, unknown> {
  if (de === para) return {};

  const campos: Record<string, unknown> = {
    estagio: para,
    estagio_alterado_em: agoraIso,
  };

  const ordemDe = ordemEstagio(de);
  const ordemPara = ordemEstagio(para);
  const ordemLink = ordemEstagio("link_enviado");

  if (para === "link_enviado") {
    campos.link_enviado_em = agoraIso;
  } else if (ordemDe >= ordemLink && ordemPara < ordemLink) {
    // Retrocedeu para antes do link: o marco não vale mais.
    campos.link_enviado_em = null;
  }

  if (de === "perdido") campos.motivo_perdido = null;

  return campos;
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/estagios.test.ts
```

Esperado: PASSA, 9 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/crm/estagios.ts src/lib/crm/estagios.test.ts
git commit -m "feat(crm): estagios do funil com carimbo de data (puro)"
```

---

## Task 3: Fake do Supabase + funções de lead

**Arquivos:**
- Criar: `src/lib/crm/admin-fake.ts` (helper de teste — sufixo proposital, não é coletado)
- Criar: `src/lib/crm/leads.server.ts`
- Testar: `src/lib/crm/leads.server.test.ts`

**Interfaces:**
- Consome: `camposDeTransicao`, `ehEstagio`, `Estagio` da Task 2
- Produz:
  - `criarAdminFake(respostas?): { from, chamadas }` — `chamadas` é
    `Array<{ tabela, operacao, payload, filtros }>`; `respostas` é mapa
    `"tabela.operacao" -> { data, error } | (chamada) => { data, error }`
  - `obterLead(admin, leadId): Promise<any | null>`
  - `atualizarLead(admin, leadId, campos: { nome?, maquina_interesse? }): Promise<void>`
  - `moverEstagio(admin, leadId, para: Estagio, detalhe?): Promise<boolean>`
  - `marcarPrecisaAtencao(admin, leadId, motivo: string): Promise<void>`
  - `registrarNota(admin, leadId, texto: string): Promise<void>`

- [ ] **Passo 1: Escrever o fake do query builder**

`src/lib/crm/admin-fake.ts`:

```ts
// Fake mínimo do query builder do supabase-js, só com o encadeamento que os
// módulos deste projeto usam. NÃO tem sufixo .test.ts de propósito: o runner
// coleta "src/**/*.test.ts" e este arquivo é helper, não suíte.
//
// Uso:
//   const admin = criarAdminFake({ "leads.select": { data: { id: "L1" }, error: null } });
//   await obterLead(admin, "L1");
//   assert.equal(admin.chamadas[0].tabela, "leads");

export type ChamadaFake = {
  tabela: string;
  operacao: "select" | "insert" | "update" | "delete";
  payload?: any;
  filtros: Array<[string, any]>;
};

type Resposta = { data?: any; error?: any };
type Respostas = Record<string, Resposta | ((chamada: ChamadaFake) => Resposta)>;

export function criarAdminFake(respostas: Respostas = {}) {
  const chamadas: ChamadaFake[] = [];

  function construir(tabela: string) {
    const chamada: ChamadaFake = { tabela, operacao: "select", filtros: [] };
    let registrada = false;

    // Só resolve no fim do encadeamento (await, .maybeSingle(), .single()),
    // quando a operação e os filtros já estão todos definidos.
    function finalizar(): Resposta {
      if (!registrada) {
        chamadas.push(chamada);
        registrada = true;
      }
      const bruto = respostas[`${chamada.tabela}.${chamada.operacao}`];
      const resposta = typeof bruto === "function" ? bruto(chamada) : bruto;
      return resposta ?? { data: null, error: null };
    }

    const api: any = {
      select: () => api,
      insert: (payload: any) => { chamada.operacao = "insert"; chamada.payload = payload; return api; },
      update: (payload: any) => { chamada.operacao = "update"; chamada.payload = payload; return api; },
      delete: () => { chamada.operacao = "delete"; return api; },
      eq: (coluna: string, valor: any) => { chamada.filtros.push([coluna, valor]); return api; },
      is: (coluna: string, valor: any) => { chamada.filtros.push([coluna, valor]); return api; },
      lte: (coluna: string, valor: any) => { chamada.filtros.push([coluna, valor]); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve(finalizar()),
      single: () => Promise.resolve(finalizar()),
      // Torna o builder "thenable": `await admin.from(x).update(y).eq(...)`
      // resolve aqui, igual ao supabase-js.
      then: (aoResolver: any, aoRejeitar: any) =>
        Promise.resolve(finalizar()).then(aoResolver, aoRejeitar),
    };

    return api;
  }

  return { from: construir, chamadas };
}
```

- [ ] **Passo 2: Escrever o teste que falha**

`src/lib/crm/leads.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import {
  obterLead, atualizarLead, moverEstagio, marcarPrecisaAtencao, registrarNota,
} from "./leads.server.ts";

test("obterLead busca por id e devolve a linha", async () => {
  const admin = criarAdminFake({ "leads.select": { data: { id: "L1", estagio: "novo" }, error: null } });
  const lead = await obterLead(admin, "L1");
  assert.equal(lead.id, "L1");
  assert.deepEqual(admin.chamadas[0].filtros, [["id", "L1"]]);
});

test("obterLead devolve null quando não existe", async () => {
  const admin = criarAdminFake({ "leads.select": { data: null, error: null } });
  assert.equal(await obterLead(admin, "sumido"), null);
});

test("atualizarLead ignora campos undefined", async () => {
  const admin = criarAdminFake();
  await atualizarLead(admin, "L1", { nome: "Ana", maquina_interesse: undefined });
  const update = admin.chamadas.find((c) => c.operacao === "update");
  assert.deepEqual(update?.payload, { nome: "Ana" });
});

test("atualizarLead não toca no banco quando não há nada para mudar", async () => {
  const admin = criarAdminFake();
  await atualizarLead(admin, "L1", {});
  assert.equal(admin.chamadas.length, 0);
});

test("moverEstagio grava campos da transição e registra evento", async () => {
  const admin = criarAdminFake({
    "leads.select": { data: { id: "L1", estagio: "novo" }, error: null },
  });
  const mudou = await moverEstagio(admin, "L1", "qualificando");
  assert.equal(mudou, true);

  const update = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(update?.payload.estagio, "qualificando");
  assert.ok(update?.payload.estagio_alterado_em);

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "mudou_estagio");
  assert.deepEqual(evento?.payload.detalhe.de, "novo");
  assert.deepEqual(evento?.payload.detalhe.para, "qualificando");
});

test("moverEstagio para o mesmo estágio é no-op sem evento", async () => {
  const admin = criarAdminFake({
    "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null },
  });
  const mudou = await moverEstagio(admin, "L1", "qualificando");
  assert.equal(mudou, false);
  assert.equal(admin.chamadas.some((c) => c.tabela === "eventos_lead"), false);
});

test("moverEstagio para lead inexistente devolve false", async () => {
  const admin = criarAdminFake({ "leads.select": { data: null, error: null } });
  assert.equal(await moverEstagio(admin, "sumido", "qualificando"), false);
});

test("marcarPrecisaAtencao liga a flag e registra o motivo no evento", async () => {
  const admin = criarAdminFake();
  await marcarPrecisaAtencao(admin, "L1", "pediu para falar com humano");

  const update = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(update?.payload.precisa_atencao, true);

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "escalado");
  assert.equal(evento?.payload.detalhe.motivo, "pediu para falar com humano");
});

test("registrarNota grava evento do tipo nota", async () => {
  const admin = criarAdminFake();
  await registrarNota(admin, "L1", "cliente prefere ligar de manhã");
  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nota");
  assert.equal(evento?.payload.detalhe.texto, "cliente prefere ligar de manhã");
});
```

- [ ] **Passo 3: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/crm/leads.server.test.ts
```

Esperado: FALHA com "Cannot find module './leads.server.ts'".

- [ ] **Passo 4: Implementar**

`src/lib/crm/leads.server.ts`:

```ts
// Núcleo de lead. Recebe o client `admin` por parâmetro (mesmo formato de
// ingerirEvento) — não cria client, não lê env, não depende de sessão. Isso
// deixa o módulo testável sem HTTP e usável tanto pelo agente quanto pelas
// createServerFn que virão na Fatia 4.
import { camposDeTransicao, type Estagio } from "./estagios.ts";

export async function obterLead(admin: any, leadId: string): Promise<any | null> {
  const { data } = await admin.from("leads").select("*").eq("id", leadId).maybeSingle();
  return data ?? null;
}

export type CamposEditaveis = {
  nome?: string | null;
  maquina_interesse?: string | null;
};

export async function atualizarLead(
  admin: any,
  leadId: string,
  campos: CamposEditaveis,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor !== undefined) payload[chave] = valor;
  }
  // Sem nada para mudar, não gasta round-trip nem suja o atualizado_em.
  if (Object.keys(payload).length === 0) return;

  await admin.from("leads").update(payload).eq("id", leadId);
}

async function registrarEvento(
  admin: any,
  leadId: string,
  tipoEvento: string,
  detalhe: Record<string, unknown>,
): Promise<void> {
  await admin.from("eventos_lead").insert({ lead_id: leadId, tipo_evento: tipoEvento, detalhe });
}

/**
 * Move o lead de estágio e deixa rastro em eventos_lead — é o que alimenta o
 * funil da Fatia 4, mesmo papel do crm_lead_eventos no CPI.
 * Devolve false quando não houve mudança (lead inexistente ou mesmo estágio).
 */
export async function moverEstagio(
  admin: any,
  leadId: string,
  para: Estagio,
  detalheExtra: Record<string, unknown> = {},
): Promise<boolean> {
  const lead = await obterLead(admin, leadId);
  if (!lead) return false;

  const de = lead.estagio as Estagio;
  const campos = camposDeTransicao(de, para, new Date().toISOString());
  if (Object.keys(campos).length === 0) return false;

  await admin.from("leads").update(campos).eq("id", leadId);
  await registrarEvento(admin, leadId, "mudou_estagio", { de, para, ...detalheExtra });
  return true;
}

export async function marcarPrecisaAtencao(
  admin: any,
  leadId: string,
  motivo: string,
): Promise<void> {
  await admin.from("leads").update({ precisa_atencao: true }).eq("id", leadId);
  await registrarEvento(admin, leadId, "escalado", { motivo });
}

export async function registrarNota(admin: any, leadId: string, texto: string): Promise<void> {
  await registrarEvento(admin, leadId, "nota", { texto });
}
```

- [ ] **Passo 5: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/leads.server.test.ts
```

Esperado: PASSA, 9 testes.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/crm/admin-fake.ts src/lib/crm/leads.server.ts src/lib/crm/leads.server.test.ts
git commit -m "feat(crm): funcoes de lead com evento de auditoria e fake do supabase"
```

---

## Task 4: Conversas — agendamento, lock e pausa

**Arquivos:**
- Criar: `src/lib/crm/conversas.server.ts`
- Testar: `src/lib/crm/conversas.server.test.ts`

**Interfaces:**
- Consome: `criarAdminFake` da Task 3
- Produz:
  - `agendarResposta(admin, conversaId, atrasoMs: number): Promise<void>`
  - `agendarFollowup(admin, conversaId, atrasoMs: number): Promise<void>`
  - `limparAgendamento(admin, conversaId): Promise<void>`
  - `registrarFalha(admin, conversaId, tentativas: number, erro: string): Promise<void>`
  - `pausarIa(admin, conversaId): Promise<void>` / `retomarIa(admin, conversaId): Promise<void>`
  - `marcarLida(admin, leadId): Promise<void>`
  - `listarConversas(admin, limite?): Promise<any[]>`
  - `MS_POR_TENTATIVA = 30_000`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/crm/conversas.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import {
  agendarResposta, agendarFollowup, limparAgendamento, registrarFalha,
  pausarIa, retomarIa, marcarLida, MS_POR_TENTATIVA,
} from "./conversas.server.ts";

function payloadUpdate(admin: any) {
  return admin.chamadas.find((c: any) => c.operacao === "update")?.payload;
}

test("agendarResposta grava responder_em no futuro com motivo resposta", async () => {
  const admin = criarAdminFake();
  const antes = Date.now();
  await agendarResposta(admin, "C1", 8000);

  const p = payloadUpdate(admin);
  assert.equal(p.motivo_agendamento, "resposta");
  const quando = new Date(p.responder_em).getTime();
  assert.ok(quando >= antes + 8000, "responder_em tem que estar ~8s à frente");
  // Toda mensagem nova reabre o crédito de tentativas: um erro antigo não pode
  // condenar a próxima resposta.
  assert.equal(p.tentativas, 0);
  assert.equal(p.ultimo_erro, null);
});

test("agendarFollowup usa motivo followup", async () => {
  const admin = criarAdminFake();
  await agendarFollowup(admin, "C1", 3600_000);
  assert.equal(payloadUpdate(admin).motivo_agendamento, "followup");
});

test("limparAgendamento zera responder_em, motivo e lock", async () => {
  const admin = criarAdminFake();
  await limparAgendamento(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.responder_em, null);
  assert.equal(p.motivo_agendamento, null);
  assert.equal(p.processando_em, null);
});

test("registrarFalha aplica backoff exponencial e solta o lock", async () => {
  const admin = criarAdminFake();
  const antes = Date.now();
  await registrarFalha(admin, "C1", 2, "openai 503");

  const p = payloadUpdate(admin);
  assert.equal(p.tentativas, 2);
  assert.equal(p.ultimo_erro, "openai 503");
  assert.equal(p.processando_em, null, "o lock precisa ser solto para o próximo tick");
  const quando = new Date(p.responder_em).getTime();
  // 30s * 2^2 = 120s
  assert.ok(quando >= antes + MS_POR_TENTATIVA * 4);
});

test("registrarFalha na 3ª tentativa desiste em vez de reagendar", async () => {
  const admin = criarAdminFake();
  await registrarFalha(admin, "C1", 3, "openai 503");
  const p = payloadUpdate(admin);
  assert.equal(p.responder_em, null, "na 3ª desiste: quem assume é o Pedro");
});

test("pausarIa liga a flag e carimba assumida_em", async () => {
  const admin = criarAdminFake();
  await pausarIa(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.pausada_pela_ia, true);
  assert.ok(p.assumida_em);
});

test("retomarIa desliga a flag e limpa assumida_em", async () => {
  const admin = criarAdminFake();
  await retomarIa(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.pausada_pela_ia, false);
  assert.equal(p.assumida_em, null);
});

test("marcarLida zera o contador de não lidas do lead", async () => {
  const admin = criarAdminFake();
  await marcarLida(admin, "L1");
  const chamada = admin.chamadas.find((c: any) => c.tabela === "leads");
  assert.equal(chamada.payload.nao_lidas, 0);
  assert.deepEqual(chamada.filtros, [["id", "L1"]]);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/crm/conversas.server.test.ts
```

Esperado: FALHA com "Cannot find module './conversas.server.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/crm/conversas.server.ts`:

```ts
// Agendamento, lock e pausa da conversa. O worker (src/lib/worker) varre por
// responder_em; tudo que mexe nessa coluna passa por aqui.

/** Base do backoff: 30s, 60s, 120s. */
export const MS_POR_TENTATIVA = 30_000;

/** Depois de 3 falhas seguidas o agente desiste e o lead vira problema do Pedro. */
export const MAX_TENTATIVAS = 3;

async function agendar(
  admin: any,
  conversaId: string,
  atrasoMs: number,
  motivo: "resposta" | "followup",
): Promise<void> {
  await admin
    .from("conversas")
    .update({
      responder_em: new Date(Date.now() + atrasoMs).toISOString(),
      motivo_agendamento: motivo,
      // Mensagem nova reabre o crédito: uma falha de ontem não pode condenar
      // a resposta de hoje.
      tentativas: 0,
      ultimo_erro: null,
    })
    .eq("id", conversaId);
}

export function agendarResposta(admin: any, conversaId: string, atrasoMs: number) {
  return agendar(admin, conversaId, atrasoMs, "resposta");
}

export function agendarFollowup(admin: any, conversaId: string, atrasoMs: number) {
  return agendar(admin, conversaId, atrasoMs, "followup");
}

export async function limparAgendamento(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ responder_em: null, motivo_agendamento: null, processando_em: null })
    .eq("id", conversaId);
}

/**
 * Registra a falha do turno e decide se tenta de novo.
 * `tentativas` é o número já incrementado (1 na primeira falha).
 */
export async function registrarFalha(
  admin: any,
  conversaId: string,
  tentativas: number,
  erro: string,
): Promise<void> {
  const desistiu = tentativas >= MAX_TENTATIVAS;
  await admin
    .from("conversas")
    .update({
      tentativas,
      ultimo_erro: erro.slice(0, 500),
      // Solta o lock sempre — senão a conversa fica presa até o varredor de
      // órfãos passar.
      processando_em: null,
      responder_em: desistiu
        ? null
        : new Date(Date.now() + MS_POR_TENTATIVA * 2 ** tentativas).toISOString(),
    })
    .eq("id", conversaId);
}

export async function pausarIa(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ pausada_pela_ia: true, assumida_em: new Date().toISOString() })
    .eq("id", conversaId);
}

export async function retomarIa(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ pausada_pela_ia: false, assumida_em: null })
    .eq("id", conversaId);
}

export async function marcarLida(admin: any, leadId: string): Promise<void> {
  await admin.from("leads").update({ nao_lidas: 0 }).eq("id", leadId);
}

/** Lista para o inbox da Fatia 4: lead + estado da conversa, mais recente primeiro. */
export async function listarConversas(admin: any, limite = 50): Promise<any[]> {
  const { data } = await admin
    .from("leads")
    .select(
      "id, nome, telefone, estagio, precisa_atencao, nao_lidas, ultima_mensagem_em," +
        " ultima_mensagem_preview, ultima_mensagem_direcao, conversas(id, pausada_pela_ia)",
    )
    .order("ultima_mensagem_em", { ascending: false })
    .limit(limite);
  return data ?? [];
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/conversas.server.test.ts
```

Esperado: PASSA, 8 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/crm/conversas.server.ts src/lib/crm/conversas.server.test.ts
git commit -m "feat(crm): agendamento, backoff e pausa da conversa"
```

---

## Task 5: Mensagens — histórico e envio

**Arquivos:**
- Criar: `src/lib/crm/mensagens.server.ts`
- Testar: `src/lib/crm/mensagens.server.test.ts`

**Interfaces:**
- Consome: `criarAdminFake` (Task 3), `enviarTexto` de `src/lib/uazapi/client.server.ts`
- Produz:
  - `listarMensagens(admin, conversaId, limite?): Promise<any[]>`
  - `enviarTextoDoCrm(admin, params, deps?): Promise<{ ok: boolean; erro?: string }>` onde
    `params = { conversaId, leadId, telefone, texto, remetente: "ia" | "humano" }` e
    `deps = { enviar?: (numero, texto) => Promise<any> }` (injeção só para teste)

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/crm/mensagens.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { enviarTextoDoCrm } from "./mensagens.server.ts";

const BASE = {
  conversaId: "C1", leadId: "L1", telefone: "5511987654321",
  texto: "Oi! Tudo bem?", remetente: "ia" as const,
};

test("grava a mensagem como pendente ANTES de tentar enviar", async () => {
  const ordem: string[] = [];
  const admin = criarAdminFake({
    "mensagens.insert": (c: any) => { ordem.push(`insert:${c.payload.status}`); return { data: { id: "M1" }, error: null }; },
  });
  await enviarTextoDoCrm(admin, BASE, {
    enviar: async () => { ordem.push("uazapi"); return { messageid: "WA1" }; },
  });
  assert.deepEqual(ordem.slice(0, 2), ["insert:pendente", "uazapi"]);
});

test("no sucesso marca enviada e guarda o provider_message_id", async () => {
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  const r = await enviarTextoDoCrm(admin, BASE, { enviar: async () => ({ messageid: "WA1" }) });

  assert.equal(r.ok, true);
  const update = admin.chamadas.find((c) => c.tabela === "mensagens" && c.operacao === "update");
  assert.equal(update?.payload.status, "enviada");
  assert.equal(update?.payload.provider_message_id, "WA1");
});

test("aceita id da UAZAPI vindo como `id` em vez de `messageid`", async () => {
  // A UAZAPI não é consistente entre endpoints; a Fatia 1 já apanhou disso
  // com sourceID/sourceId. Aceita as duas grafias.
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  await enviarTextoDoCrm(admin, BASE, { enviar: async () => ({ id: "WA2" }) });
  const update = admin.chamadas.find((c) => c.tabela === "mensagens" && c.operacao === "update");
  assert.equal(update?.payload.provider_message_id, "WA2");
});

test("falha no envio marca a mensagem como falhou e não lança", async () => {
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  const r = await enviarTextoDoCrm(admin, BASE, {
    enviar: async () => { throw new Error("UAZAPI 500"); },
  });

  assert.equal(r.ok, false);
  assert.match(r.erro ?? "", /UAZAPI 500/);
  const update = admin.chamadas.find((c) => c.tabela === "mensagens" && c.operacao === "update");
  assert.equal(update?.payload.status, "falhou");
});

test("grava direcao out e o remetente recebido", async () => {
  const admin = criarAdminFake({ "mensagens.insert": { data: { id: "M1" }, error: null } });
  await enviarTextoDoCrm(admin, { ...BASE, remetente: "humano" }, { enviar: async () => ({}) });

  const insert = admin.chamadas.find((c) => c.operacao === "insert");
  assert.equal(insert?.payload.direcao, "out");
  assert.equal(insert?.payload.remetente, "humano");
  assert.equal(insert?.payload.tipo, "texto");
  assert.equal(insert?.payload.conteudo, BASE.texto);
});

test("sem telefone não tenta enviar e devolve erro", async () => {
  const admin = criarAdminFake();
  let tentou = false;
  const r = await enviarTextoDoCrm(admin, { ...BASE, telefone: "" }, {
    enviar: async () => { tentou = true; return {}; },
  });
  assert.equal(r.ok, false);
  assert.equal(tentou, false);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/crm/mensagens.server.test.ts
```

Esperado: FALHA com "Cannot find module './mensagens.server.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/crm/mensagens.server.ts`:

```ts
// Histórico e envio de texto. Usado pelo agente (remetente "ia") e, na Fatia 5,
// pelo Pedro respondendo no inbox (remetente "humano") — uma implementação só.

export async function listarMensagens(
  admin: any,
  conversaId: string,
  limite = 50,
): Promise<any[]> {
  const { data } = await admin
    .from("mensagens")
    .select("id, remetente, direcao, tipo, conteudo, transcricao, transcricao_status, status, timestamp_ms, criado_em")
    .eq("conversa_id", conversaId)
    .order("timestamp_ms", { ascending: false })
    .limit(limite);
  // O banco devolve do mais novo para o mais velho (o índice é assim); a
  // conversa se lê ao contrário.
  return (data ?? []).slice().reverse();
}

export type ParamsEnvio = {
  conversaId: string;
  leadId: string;
  telefone: string | null;
  texto: string;
  remetente: "ia" | "humano";
};

export type DepsEnvio = {
  /** Injetável só para teste. Em produção resolve para a UAZAPI. */
  enviar?: (numero: string, texto: string) => Promise<any>;
};

async function enviarPelaUazapi(numero: string, texto: string): Promise<any> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) throw new Error("UAZAPI_TOKEN não configurado");
  const { enviarTexto } = await import("../uazapi/client.server.ts");
  return enviarTexto(token, numero, texto);
}

/**
 * Grava a mensagem como `pendente`, envia, e só então marca `enviada`.
 *
 * A ordem importa: se gravássemos depois do envio, uma falha na gravação
 * deixaria o lead com uma mensagem que não existe no histórico. Deste jeito o
 * pior caso é uma linha `falhou` visível — nunca um buraco silencioso.
 *
 * Nunca lança: devolve `{ ok: false, erro }`, porque quem chama é o worker e
 * uma exceção aqui derrubaria o turno inteiro.
 */
export async function enviarTextoDoCrm(
  admin: any,
  params: ParamsEnvio,
  deps: DepsEnvio = {},
): Promise<{ ok: boolean; erro?: string }> {
  const texto = params.texto?.trim();
  if (!texto) return { ok: false, erro: "texto vazio" };
  if (!params.telefone) return { ok: false, erro: "lead sem telefone" };

  const { data: mensagem, error } = await admin
    .from("mensagens")
    .insert({
      conversa_id: params.conversaId,
      lead_id: params.leadId,
      remetente: params.remetente,
      direcao: "out",
      tipo: "texto",
      conteudo: texto,
      status: "pendente",
      timestamp_ms: Date.now(),
    })
    .select("id")
    .single();

  if (error) return { ok: false, erro: error.message };

  const enviar = deps.enviar ?? enviarPelaUazapi;

  try {
    const resposta = await enviar(params.telefone, texto);
    // A UAZAPI alterna entre `messageid` e `id` conforme o endpoint — a Fatia 1
    // já tinha apanhado da mesma inconsistência com sourceID/sourceId.
    const providerId = resposta?.messageid ?? resposta?.id ?? null;
    await admin
      .from("mensagens")
      .update({ status: "enviada", provider_message_id: providerId })
      .eq("id", mensagem.id);
    return { ok: true };
  } catch (err: any) {
    const erro = err?.message ?? "erro desconhecido ao enviar";
    await admin.from("mensagens").update({ status: "falhou" }).eq("id", mensagem.id);
    return { ok: false, erro };
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/mensagens.server.test.ts
```

Esperado: PASSA, 6 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/crm/mensagens.server.ts src/lib/crm/mensagens.server.test.ts
git commit -m "feat(crm): envio de texto grava pendente antes de enviar"
```

---

## Task 6: Tarefas (lembretes manuais)

**Arquivos:**
- Criar: `src/lib/crm/tarefas.server.ts`
- Testar: `src/lib/crm/tarefas.server.test.ts`

**Interfaces:**
- Consome: `criarAdminFake` (Task 3)
- Produz:
  - `listarTarefas(admin, filtro?: { leadId?: string; concluida?: boolean }): Promise<any[]>`
  - `criarTarefa(admin, { leadId, titulo, descricao?, prazo? }): Promise<any>`
  - `alternarTarefa(admin, tarefaId, concluida: boolean): Promise<void>`
  - `excluirTarefa(admin, tarefaId): Promise<void>`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/crm/tarefas.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { listarTarefas, criarTarefa, alternarTarefa, excluirTarefa } from "./tarefas.server.ts";

test("criarTarefa exige título não vazio", async () => {
  const admin = criarAdminFake();
  await assert.rejects(
    () => criarTarefa(admin, { leadId: "L1", titulo: "   " }),
    /título/i,
  );
  assert.equal(admin.chamadas.length, 0);
});

test("criarTarefa grava lead, título e prazo", async () => {
  const admin = criarAdminFake({ "tarefas.insert": { data: { id: "T1" }, error: null } });
  await criarTarefa(admin, { leadId: "L1", titulo: "Ligar", prazo: "2026-08-10T12:00:00.000Z" });

  const insert = admin.chamadas.find((c) => c.operacao === "insert");
  assert.equal(insert?.payload.lead_id, "L1");
  assert.equal(insert?.payload.titulo, "Ligar");
  assert.equal(insert?.payload.prazo, "2026-08-10T12:00:00.000Z");
  assert.equal(insert?.payload.concluida, false);
});

test("alternarTarefa para concluída carimba concluida_em", async () => {
  const admin = criarAdminFake();
  await alternarTarefa(admin, "T1", true);
  const p = admin.chamadas[0].payload;
  assert.equal(p.concluida, true);
  assert.ok(p.concluida_em);
});

test("alternarTarefa para pendente limpa concluida_em", async () => {
  const admin = criarAdminFake();
  await alternarTarefa(admin, "T1", false);
  const p = admin.chamadas[0].payload;
  assert.equal(p.concluida, false);
  assert.equal(p.concluida_em, null);
});

test("listarTarefas filtra por lead quando pedido", async () => {
  const admin = criarAdminFake({ "tarefas.select": { data: [{ id: "T1" }], error: null } });
  const r = await listarTarefas(admin, { leadId: "L1" });
  assert.equal(r.length, 1);
  assert.deepEqual(admin.chamadas[0].filtros, [["lead_id", "L1"]]);
});

test("listarTarefas sem filtro não aplica nenhum eq", async () => {
  const admin = criarAdminFake({ "tarefas.select": { data: [], error: null } });
  await listarTarefas(admin);
  assert.deepEqual(admin.chamadas[0].filtros, []);
});

test("excluirTarefa usa delete filtrando por id", async () => {
  const admin = criarAdminFake();
  await excluirTarefa(admin, "T1");
  assert.equal(admin.chamadas[0].operacao, "delete");
  assert.deepEqual(admin.chamadas[0].filtros, [["id", "T1"]]);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/crm/tarefas.server.test.ts
```

Esperado: FALHA com "Cannot find module './tarefas.server.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/crm/tarefas.server.ts`:

```ts
// Lembretes manuais do Pedro. Molde do crm_tasks do CPI, sem multi-tenancy
// (uso individual) e sem responsavel_id (só existe um usuário).
// A IA nunca escreve aqui — ela escala via precisa_atencao, não criando tarefa.

export type NovaTarefa = {
  leadId: string;
  titulo: string;
  descricao?: string | null;
  prazo?: string | null;
};

export async function criarTarefa(admin: any, nova: NovaTarefa): Promise<any> {
  const titulo = nova.titulo?.trim();
  if (!titulo) throw new Error("título da tarefa é obrigatório");

  const { data, error } = await admin
    .from("tarefas")
    .insert({
      lead_id: nova.leadId,
      titulo,
      descricao: nova.descricao ?? null,
      prazo: nova.prazo ?? null,
      concluida: false,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function listarTarefas(
  admin: any,
  filtro: { leadId?: string; concluida?: boolean } = {},
): Promise<any[]> {
  let consulta = admin.from("tarefas").select("*");
  if (filtro.leadId) consulta = consulta.eq("lead_id", filtro.leadId);
  if (filtro.concluida !== undefined) consulta = consulta.eq("concluida", filtro.concluida);
  const { data } = await consulta.order("prazo", { ascending: true });
  return data ?? [];
}

export async function alternarTarefa(
  admin: any,
  tarefaId: string,
  concluida: boolean,
): Promise<void> {
  await admin
    .from("tarefas")
    .update({
      concluida,
      concluida_em: concluida ? new Date().toISOString() : null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", tarefaId);
}

export async function excluirTarefa(admin: any, tarefaId: string): Promise<void> {
  await admin.from("tarefas").delete().eq("id", tarefaId);
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/tarefas.server.test.ts
```

Esperado: PASSA, 7 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/crm/tarefas.server.ts src/lib/crm/tarefas.server.test.ts
git commit -m "feat(crm): tarefas manuais no molde do crm_tasks do CPI"
```

---

## Task 7: Webhook agenda a resposta

**Arquivos:**
- Modificar: `src/lib/uazapi/ingest.server.ts` (a função `ingerirMensagem`, no bloco final
  depois do `insert` em `mensagens`)
- Criar: `src/lib/uazapi/deve-agendar.ts`
- Testar: `src/lib/uazapi/deve-agendar.test.ts`

**Interfaces:**
- Consome: `agendarResposta` da Task 4
- Produz: `deveAgendarResposta({ direcao, pausada, precisaAtencao, agenteAtivo }): boolean`

A decisão sai para um módulo puro porque `ingest.server.ts` não é testável direto (importa
Storage, Groq e CAPI). O `ingest` fica só com a chamada.

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/uazapi/deve-agendar.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deveAgendarResposta } from "./deve-agendar.ts";

const PADRAO = { direcao: "in" as const, pausada: false, precisaAtencao: false, agenteAtivo: true };

test("agenda para mensagem recebida do lead", () => {
  assert.equal(deveAgendarResposta(PADRAO), true);
});

test("não agenda para mensagem enviada (eco do próprio envio)", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, direcao: "out" }), false);
});

test("não agenda com a conversa assumida pelo humano", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, pausada: true }), false);
});

test("não agenda com o lead já escalado", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, precisaAtencao: true }), false);
});

test("não agenda com o agente desligado por env", () => {
  assert.equal(deveAgendarResposta({ ...PADRAO, agenteAtivo: false }), false);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/uazapi/deve-agendar.test.ts
```

Esperado: FALHA com "Cannot find module './deve-agendar.ts'".

- [ ] **Passo 3: Implementar o módulo puro**

`src/lib/uazapi/deve-agendar.ts`:

```ts
// Puro: decide se a chegada de uma mensagem deve acordar o agente.
// Separado do ingest.server.ts porque aquele arquivo importa Storage, Groq e
// CAPI e não roda sob node --test.

export type ContextoAgendamento = {
  direcao: "in" | "out";
  /** conversas.pausada_pela_ia — o Pedro assumiu esta conversa. */
  pausada: boolean;
  /** leads.precisa_atencao — o agente já escalou este lead. */
  precisaAtencao: boolean;
  /** AGENTE_ATIVO — desliga o agente inteiro sem redeploy. */
  agenteAtivo: boolean;
};

export function deveAgendarResposta(ctx: ContextoAgendamento): boolean {
  if (!ctx.agenteAtivo) return false;
  // Mensagem "out" é o eco do que nós mesmos enviamos — responder a ela seria
  // o agente conversando sozinho.
  if (ctx.direcao !== "in") return false;
  if (ctx.pausada) return false;
  if (ctx.precisaAtencao) return false;
  return true;
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/uazapi/deve-agendar.test.ts
```

Esperado: PASSA, 5 testes.

- [ ] **Passo 5: Plugar no ingest**

Em `src/lib/uazapi/ingest.server.ts`, substitua o bloco final da função `ingerirMensagem`
(hoje termina em `return { status: "ok", leadId: alvo.leadId };`) por:

```ts
  if (error) {
    // Idempotência camada 2: corrida entre duas entregas do mesmo webhook.
    if ((error as any).code === "23505") return { status: "duplicate" };
    return { status: "error", error: error.message };
  }

  // Acorda o agente. Best-effort: uma falha aqui não pode custar a mensagem
  // que já foi gravada — no pior caso o lead fica sem resposta automática e
  // aparece como não lido para o Pedro.
  try {
    const { deveAgendarResposta } = await import("./deve-agendar.ts");
    const { agendarResposta } = await import("../crm/conversas.server.ts");

    const { data: estado } = await admin
      .from("conversas")
      .select("pausada_pela_ia, leads(precisa_atencao)")
      .eq("id", alvo.conversaId)
      .maybeSingle();

    const contexto = {
      direcao: msg.direcao as "in" | "out",
      pausada: Boolean(estado?.pausada_pela_ia),
      precisaAtencao: Boolean((estado as any)?.leads?.precisa_atencao),
      agenteAtivo: process.env.AGENTE_ATIVO !== "false",
    };

    if (deveAgendarResposta(contexto)) {
      const atraso = Number(process.env.AGENTE_DEBOUNCE_MS) || 8000;
      await agendarResposta(admin, alvo.conversaId, atraso);
    }
  } catch (err: any) {
    console.warn(`[ingest] falha ao agendar resposta da conversa ${alvo.conversaId}:`, err?.message ?? err);
  }

  return { status: "ok", leadId: alvo.leadId };
```

- [ ] **Passo 6: Conferir o formato do join aninhado**

O `select("pausada_pela_ia, leads(precisa_atencao)")` depende de o Postgrest enxergar a FK
`conversas.lead_id → leads.id`. Verifique com uma consulta real:

```bash
node --experimental-strip-types -e '
const { createClient } = await import("@supabase/supabase-js");
const a = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await a.from("conversas").select("pausada_pela_ia, leads(precisa_atencao)").limit(1);
console.log(JSON.stringify({ data, error }, null, 2));
'
```

Se `leads` vier como **array** em vez de objeto, ajuste para
`(estado as any)?.leads?.[0]?.precisa_atencao`. Se der erro de relacionamento, troque por duas
consultas separadas (`conversas` e depois `leads`) — não force o join.

- [ ] **Passo 7: Rodar a suíte inteira**

```bash
npm test
```

Esperado: todos os testes da Fatia 1 continuam passando, mais os novos.

- [ ] **Passo 8: Commit**

```bash
git add src/lib/uazapi/deve-agendar.ts src/lib/uazapi/deve-agendar.test.ts src/lib/uazapi/ingest.server.ts
git commit -m "feat(webhook): agenda a resposta do agente ao gravar mensagem do lead"
```

---

## Task 8: Spike — capturar a resposta real da OpenAI

**Arquivos:**
- Criar: `src/lib/agente/fixtures/openai-tool-call.json`
- Criar: `src/lib/agente/fixtures/openai-texto.json`
- Criar: `scripts/capturar-openai.ts`

**Interfaces:**
- Consome: `OPENAI_API_KEY`, `OPENAI_MODEL` do `.env`
- Produz: dois fixtures com a resposta **real** da API, usados como base dos testes da Task 9

> **Por que esta tarefa existe.** Na Fatia 1, 49 testes passavam contra fixtures inventados e
> a função falhou 6/6 contra payload real, porque `content` vinha como string JSON, não
> objeto. Não repita: o formato exato da resposta do `gpt-5.4-mini` com tool calling —
> inclusive **se o endpoint certo é `/v1/chat/completions` ou `/v1/responses`** — se descobre
> chamando, não supondo.

- [ ] **Passo 1: Escrever o script de captura**

`scripts/capturar-openai.ts`:

```ts
// Captura respostas REAIS da OpenAI para virarem fixtures de teste.
// Rodar: bun --env-file=.env run scripts/capturar-openai.ts
import { mkdir, writeFile } from "node:fs/promises";

const MODELO = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const CHAVE = process.env.OPENAI_API_KEY;
if (!CHAVE) throw new Error("OPENAI_API_KEY não configurado");

const DESTINO = "src/lib/agente/fixtures";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "escalar_para_humano",
      description: "Escala a conversa para o consultor humano e para de responder.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", description: "Por que está escalando" } },
        required: ["motivo"],
        additionalProperties: false,
      },
    },
  },
];

async function chamar(mensagens: unknown[], comTools: boolean) {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE}` },
    body: JSON.stringify({
      model: MODELO,
      messages: mensagens,
      ...(comTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
    }),
  });
  const texto = await resposta.text();
  console.log(`HTTP ${resposta.status}`);
  return { status: resposta.status, corpo: texto };
}

await mkdir(DESTINO, { recursive: true });

// 1) Turno que deve resultar em tool call.
const comTool = await chamar(
  [
    { role: "system", content: "Você é um consultor. Se o cliente pedir para falar com uma pessoa, chame a tool escalar_para_humano." },
    { role: "user", content: "quero falar com uma pessoa de verdade, não com robô" },
  ],
  true,
);
await writeFile(`${DESTINO}/openai-tool-call.json`, comTool.corpo);
console.log("gravado openai-tool-call.json");

// 2) Turno de texto puro.
const soTexto = await chamar(
  [
    { role: "system", content: "Você é um consultor de maquininhas. Responda em uma frase." },
    { role: "user", content: "oi, queria saber sobre maquininha" },
  ],
  false,
);
await writeFile(`${DESTINO}/openai-texto.json`, soTexto.corpo);
console.log("gravado openai-texto.json");
```

- [ ] **Passo 2: Rodar a captura**

```bash
bun --env-file=.env run scripts/capturar-openai.ts
```

- [ ] **Passo 3: Ler os fixtures e anotar o formato**

```bash
cat src/lib/agente/fixtures/openai-tool-call.json
```

Anote, para usar na Task 9:
- O caminho até o texto (esperado: `choices[0].message.content`) — **e se ele pode vir `null`
  quando há tool call**.
- O caminho até as tool calls (esperado: `choices[0].message.tool_calls[]`, cada uma com
  `id`, `function.name`, `function.arguments` **como string JSON**, não objeto).
- O `finish_reason`.
- Se algum campo de reasoning aparece e se o `content` vem como string ou como array de
  partes.

- [ ] **Passo 4: Se `/v1/chat/completions` recusar o modelo**

Se o passo 2 devolver 400 com mensagem do tipo "use the Responses API", refaça o script
contra `https://api.openai.com/v1/responses` com o corpo
`{ model, input: [...], tools: [...] }` e capture esse formato. **A Task 9 usa o endpoint que
funcionar aqui** — não implemente contra o que este plano supõe.

- [ ] **Passo 5: Commit**

```bash
git add scripts/capturar-openai.ts src/lib/agente/fixtures/
git commit -m "chore(agente): captura resposta real da OpenAI como fixture de teste"
```

---

## Task 9: Cliente OpenAI

**Arquivos:**
- Criar: `src/lib/agente/openai.server.ts`
- Testar: `src/lib/agente/openai.server.test.ts`

**Interfaces:**
- Consome: os fixtures da Task 8
- Produz:
  - `type MensagemChat = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string }`
  - `type ToolChamada = { id: string; nome: string; argumentos: Record<string, unknown> }`
  - `type RespostaAgente = { texto: string | null; toolCalls: ToolChamada[] }`
  - `chamarOpenAI(mensagens: MensagemChat[], tools: unknown[], deps?: { fetchImpl? }): Promise<RespostaAgente>`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/openai.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chamarOpenAI } from "./openai.server.ts";

const DIR = new URL("./fixtures/", import.meta.url);

async function fixture(nome: string) {
  return JSON.parse(await readFile(new URL(nome, DIR), "utf8"));
}

function fetchFalso(corpo: unknown, status = 200) {
  return async () =>
    new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
}

test("extrai texto de resposta real sem tool call", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const r = await chamarOpenAI([{ role: "user", content: "oi" }], [], {
    fetchImpl: fetchFalso(await fixture("openai-texto.json")),
  });
  assert.equal(typeof r.texto, "string");
  assert.ok((r.texto ?? "").length > 0);
  assert.deepEqual(r.toolCalls, []);
});

test("extrai tool call de resposta real, com argumentos já parseados", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const r = await chamarOpenAI([{ role: "user", content: "quero falar com humano" }], [], {
    fetchImpl: fetchFalso(await fixture("openai-tool-call.json")),
  });
  assert.equal(r.toolCalls.length, 1);
  assert.equal(r.toolCalls[0].nome, "escalar_para_humano");
  // O importante: argumentos chegam como STRING JSON da API e saem como objeto.
  assert.equal(typeof r.toolCalls[0].argumentos, "object");
  assert.ok(r.toolCalls[0].id);
});

test("argumento com JSON inválido vira objeto vazio em vez de explodir", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  const corpo = {
    choices: [{
      message: {
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "atualizar_lead", arguments: "{quebrado" } }],
      },
    }],
  };
  const r = await chamarOpenAI([], [], { fetchImpl: fetchFalso(corpo) });
  assert.deepEqual(r.toolCalls[0].argumentos, {});
});

test("erro HTTP lança com status e trecho do corpo", async () => {
  process.env.OPENAI_API_KEY = "sk-teste";
  await assert.rejects(
    () => chamarOpenAI([], [], { fetchImpl: fetchFalso({ error: { message: "rate limit" } }, 429) }),
    /429/,
  );
});

test("sem OPENAI_API_KEY lança antes de tentar a rede", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  let bateu = false;
  await assert.rejects(
    () => chamarOpenAI([], [], { fetchImpl: async () => { bateu = true; return new Response("{}"); } }),
    /OPENAI_API_KEY/,
  );
  assert.equal(bateu, false);
  process.env.OPENAI_API_KEY = original;
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/openai.server.test.ts
```

Esperado: FALHA com "Cannot find module './openai.server.ts'".

- [ ] **Passo 3: Implementar**

> Ajuste o endpoint e os caminhos de extração ao que a Task 8 capturou de verdade. O código
> abaixo assume `/v1/chat/completions`; se o spike mostrou outro formato, siga o spike.

`src/lib/agente/openai.server.ts`:

```ts
// Cliente HTTP da OpenAI via fetch puro — mesmo padrão de capi.server.ts e
// groq-transcribe.server.ts, sem SDK e sem dependência nova no package.json.
//
// O formato de resposta tratado aqui foi capturado da API real (ver
// fixtures/openai-tool-call.json), não deduzido da documentação.

const URL_CHAT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 45_000;

export type MensagemChat = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};

export type ToolChamada = {
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
};

export type RespostaAgente = {
  texto: string | null;
  toolCalls: ToolChamada[];
};

export type DepsOpenAI = {
  /** Injetável só para teste. */
  fetchImpl?: typeof fetch;
};

export async function chamarOpenAI(
  mensagens: MensagemChat[],
  tools: unknown[],
  deps: DepsOpenAI = {},
): Promise<RespostaAgente> {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) throw new Error("OPENAI_API_KEY não configurado");

  const modelo = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const executarFetch = deps.fetchImpl ?? fetch;

  const resposta = await executarFetch(URL_CHAT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      messages: mensagens,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const bruto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`OpenAI ${resposta.status}: ${bruto.slice(0, 300)}`);
  }

  let corpo: any;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    throw new Error(`OpenAI devolveu corpo não-JSON: ${bruto.slice(0, 200)}`);
  }

  const mensagem = corpo?.choices?.[0]?.message ?? {};

  const toolCalls: ToolChamada[] = (mensagem.tool_calls ?? []).map((chamada: any) => ({
    id: chamada?.id ?? "",
    nome: chamada?.function?.name ?? "",
    // A API entrega os argumentos como STRING JSON, não objeto. Um modelo
    // pode truncar ou malformar isso — nesse caso devolve {} e deixa a
    // validação da tool reclamar, em vez de derrubar o turno inteiro.
    argumentos: parsearArgumentos(chamada?.function?.arguments),
  }));

  return { texto: typeof mensagem.content === "string" ? mensagem.content : null, toolCalls };
}

function parsearArgumentos(bruto: unknown): Record<string, unknown> {
  if (typeof bruto !== "string" || bruto.trim() === "") return {};
  try {
    const parseado = JSON.parse(bruto);
    return parseado && typeof parseado === "object" ? parseado : {};
  } catch {
    return {};
  }
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/openai.server.test.ts
```

Esperado: PASSA, 5 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/openai.server.ts src/lib/agente/openai.server.test.ts
git commit -m "feat(agente): cliente OpenAI validado contra resposta real"
```

---

## Task 10: Conhecimento e prompt

**Arquivos:**
- Criar: `src/lib/agente/conhecimento.ts`
- Criar: `src/lib/agente/prompt.ts`
- Testar: `src/lib/agente/prompt.test.ts`

**Interfaces:**
- Consome: nada (ambos puros)
- Produz:
  - `CONHECIMENTO: string` — a FAQ curada
  - `REGRAS_ESCALACAO: string`
  - `montarSystemPrompt(lead: { nome?, estagio, maquina_interesse? }): string`
  - `montarMensagens(systemPrompt, historico): MensagemChat[]`

> **Conteúdo pendente do dono.** O `conhecimento.ts` abaixo é o esqueleto aprovado no spec,
> com marcadores `[PREENCHER]`. Ele funciona: o agente lê "esta informação não está
> disponível" e escala, que é o comportamento correto enquanto o Pedro não preencher. **Não
> invente taxa, preço, prazo ou regra da Ton para tapar buraco.**

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/prompt.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONHECIMENTO } from "./conhecimento.ts";
import { montarSystemPrompt, montarMensagens } from "./prompt.ts";

const LEAD = { nome: "Ana", estagio: "qualificando", maquina_interesse: null };

test("o prompt inclui a base de conhecimento", () => {
  const p = montarSystemPrompt(LEAD);
  assert.ok(p.includes(CONHECIMENTO));
});

test("o prompt inclui nome e estágio do lead", () => {
  const p = montarSystemPrompt(LEAD);
  assert.match(p, /Ana/);
  assert.match(p, /qualificando/);
});

test("lead sem nome não vira 'null' no prompt", () => {
  const p = montarSystemPrompt({ nome: null, estagio: "novo", maquina_interesse: null });
  assert.equal(p.includes("null"), false);
});

test("o link de indicação NUNCA aparece no prompt", () => {
  process.env.TON_LINK_INDICACAO = "https://exemplo.ton/pedro-teste";
  const p = montarSystemPrompt(LEAD);
  assert.equal(p.includes("exemplo.ton"), false);
  assert.equal(p.includes(process.env.TON_LINK_INDICACAO), false);
});

test("o prompt manda escalar qualquer pergunta de taxa", () => {
  const p = montarSystemPrompt(LEAD).toLowerCase();
  assert.match(p, /taxa/);
  assert.match(p, /escalar_para_humano/);
});

test("nenhum número de taxa vazou para o conhecimento", () => {
  // Guarda dura: se alguém colar "1,99%" na FAQ, este teste quebra.
  assert.doesNotMatch(CONHECIMENTO, /\d+[.,]\d+\s*%/);
});

test("o agente nunca deve falar da própria comissão", () => {
  assert.match(montarSystemPrompt(LEAD).toLowerCase(), /comiss/);
});

test("montarMensagens põe o system na frente e o histórico na ordem", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", conteudo: "oi" },
    { remetente: "ia", conteudo: "olá!" },
    { remetente: "lead", conteudo: "quanto custa" },
  ]);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[0].content, "SYS");
  assert.deepEqual(msgs.slice(1).map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(msgs[3].content, "quanto custa");
});

test("mensagem humana entra como assistant (o lead não distingue quem falou)", () => {
  const msgs = montarMensagens("SYS", [{ remetente: "humano", conteudo: "aqui é o Pedro" }]);
  assert.equal(msgs[1].role, "assistant");
});

test("áudio entra pela transcrição", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "audio", conteudo: null, transcricao: "quero uma maquininha" },
  ]);
  assert.equal(msgs[1].content, "quero uma maquininha");
});

test("áudio sem transcrição vira marcador, não string vazia", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "audio", conteudo: null, transcricao: null, transcricao_status: "failed" },
  ]);
  assert.match(msgs[1].content ?? "", /áudio/i);
});

test("imagem vira marcador de texto nesta fatia", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "imagem", conteudo: null },
  ]);
  assert.match(msgs[1].content ?? "", /imagem/i);
});

test("mensagem sem conteúdo aproveitável é descartada", () => {
  const msgs = montarMensagens("SYS", [
    { remetente: "lead", tipo: "texto", conteudo: "  " },
    { remetente: "lead", tipo: "texto", conteudo: "oi" },
  ]);
  assert.equal(msgs.length, 2);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/prompt.test.ts
```

Esperado: FALHA com "Cannot find module './conhecimento.ts'".

- [ ] **Passo 3: Escrever o conhecimento**

`src/lib/agente/conhecimento.ts`:

```ts
// Base de conhecimento curada da Renda Ton. Puro: só string.
//
// Na Fatia 3 este conteúdo vira seed do RAG e passa a ser editável pelo Pedro
// sem mudança de código. Até lá, é este arquivo que a IA sabe.
//
// REGRA DURA: nenhum número de taxa entra aqui. Toda pergunta de taxa escala.
// Há um teste que quebra se alguém colar um percentual neste arquivo.
//
// Os [PREENCHER] são conteúdo pendente do dono do projeto. Enquanto estiverem
// aí, o agente trata o assunto como "não sei" e escala — que é o comportamento
// correto. NÃO preencha com suposição.

export const CONHECIMENTO = `
## Quem você é

Você é o assistente do Pedro, consultor parceiro da Ton (Stone Co.) no programa Renda Ton.
Você fala EM NOME do Pedro. Você NUNCA diz que é funcionário da Ton — é regra do programa.

O que o Pedro faz: orienta na escolha da maquininha e envia o link de cadastro.
O que o Pedro NÃO faz: suporte pós-venda, desbloqueio de conta, estorno, problema de
recebimento. Isso é com a Ton — [PREENCHER: canal oficial que o Pedro indica].

## As máquinas

- TapTon (o celular vira maquininha): [PREENCHER: para quem serve, preço, diferencial]
- T1: [PREENCHER]
- T2: [PREENCHER]
- T3: [PREENCHER]
- T3 Smart: [PREENCHER]
- Stone: [PREENCHER]

Para descobrir qual indicar, pergunte: [PREENCHER: as perguntas que o Pedro faz — tipo de
negócio? precisa de comprovante impresso? tem wi-fi no local?]

## Como o cliente compra

1. [PREENCHER: o que acontece quando ele clica no link]
2. [PREENCHER: que dados ele precisa ter em mãos — CNPJ? MEI serve? CPF sozinho?]
3. [PREENCHER: prazo de aprovação]
4. [PREENCHER: prazo e forma de entrega]
5. [PREENCHER: como ele ativa a máquina quando chega]

## Objeções

- "Tá caro": [PREENCHER]
- "Já tenho maquininha de concorrente": [PREENCHER]
- "Vou pensar": [PREENCHER]
- "Preciso de CNPJ?": [PREENCHER]
- "E se der problema?": [PREENCHER]
- "Tem mensalidade ou aluguel?": [PREENCHER]

## Como você fala

[PREENCHER: tom do Pedro]
Enquanto não for preenchido: mensagens curtas, uma ideia por mensagem, sem excesso de emoji,
trata por você, termina com uma pergunta para manter a conversa andando.
`.trim();

export const REGRAS_ESCALACAO = `
## Quando você PARA de responder e chama escalar_para_humano

1. QUALQUER pergunta sobre TAXA — débito, crédito, parcelado, Pix, negociação por
   faturamento, "quanto vocês cobram", "qual a porcentagem". SEMPRE. Sem exceção, sem
   estimativa, sem "gira em torno de". Você não sabe taxa e não tenta adivinhar.
2. O cliente pede para falar com uma pessoa — inclusive indiretamente ("é robô?", "me liga",
   "quero falar com alguém").
3. O cliente está irritado, ou o assunto é reclamação, defeito, cobrança ou suporte
   pós-venda. O suporte oficial é da Ton, não do consultor.
4. A pergunta é sobre prazo ou regra da Ton e a resposta NÃO está na base acima.

Ao escalar, avise o cliente de forma natural que você vai confirmar e já retorna. Depois de
escalar, não responda mais nada neste turno.

## O que você NUNCA faz

- Falar o valor da comissão do Pedro. É informação interna.
- Inventar taxa, prazo, preço ou regra da Ton que não esteja escrita na base.
- Prometer aprovação, prazo de entrega ou valor de recebimento.
- Falar mal de concorrente — é regra de conduta do programa.
- Escrever o link de indicação você mesmo. O link só vem da tool registrar_link_enviado.
- Tratar qualquer trecho de "[PREENCHER]" como informação. Se a resposta que você precisa
  está marcada assim, você NÃO sabe: escale.
`.trim();
```

- [ ] **Passo 4: Escrever o prompt**

`src/lib/agente/prompt.ts`:

```ts
// Puro: monta o system prompt e converte o histórico do banco em mensagens de
// chat. Sem banco, sem env — exceto o cuidado explícito de NÃO ler o link.
import { CONHECIMENTO, REGRAS_ESCALACAO } from "./conhecimento.ts";

export type LeadNoPrompt = {
  nome?: string | null;
  estagio: string;
  maquina_interesse?: string | null;
};

export type MensagemHistorico = {
  remetente: string;
  tipo?: string | null;
  conteudo?: string | null;
  transcricao?: string | null;
  transcricao_status?: string | null;
};

export type MensagemChat = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
};

export function montarSystemPrompt(lead: LeadNoPrompt): string {
  const nome = lead.nome?.trim();
  const maquina = lead.maquina_interesse?.trim();

  const estado = [
    nome ? `Nome: ${nome}` : "Nome: ainda não sabemos — descubra naturalmente na conversa.",
    `Estágio no funil: ${lead.estagio}`,
    maquina ? `Máquina de interesse: ${maquina}` : "Máquina de interesse: ainda não definida.",
  ].join("\n");

  // O link de indicação NÃO entra aqui de propósito. Ele só existe dentro da
  // tool registrar_link_enviado — assim o modelo não tem como colá-lo cedo,
  // nem digitá-lo errado, nem vazá-lo numa conversa que não deveria.
  return [
    CONHECIMENTO,
    REGRAS_ESCALACAO,
    "## Quando enviar o link",
    "Qualifique primeiro: entenda o negócio do cliente e qual máquina faz sentido. Só quando",
    "ele demonstrar intenção (perguntar como pega, dizer que quer) chame registrar_link_enviado",
    "e cole na sua resposta o link que a tool devolver. Nunca escreva um link de memória.",
    "## Estado deste lead",
    estado,
  ].join("\n\n");
}

/** O que o lead escreveu, resolvendo áudio e mídia para texto. */
function textoDaMensagem(m: MensagemHistorico): string | null {
  const conteudo = m.conteudo?.trim();
  if (conteudo) return conteudo;

  const transcricao = m.transcricao?.trim();
  if (transcricao) return transcricao;

  // Sem texto e sem transcrição: um marcador é melhor que sumir com a
  // mensagem, porque o modelo precisa saber que ALGO chegou.
  switch (m.tipo) {
    case "audio": return "[o cliente enviou um áudio que não foi possível transcrever]";
    case "imagem": return "[o cliente enviou uma imagem]";
    case "documento": return "[o cliente enviou um documento]";
    case "video": return "[o cliente enviou um vídeo]";
    case "sticker": return "[o cliente enviou uma figurinha]";
    default: return null;
  }
}

export function montarMensagens(
  systemPrompt: string,
  historico: MensagemHistorico[],
): MensagemChat[] {
  const mensagens: MensagemChat[] = [{ role: "system", content: systemPrompt }];

  for (const m of historico) {
    const texto = textoDaMensagem(m);
    if (!texto) continue;
    // "humano" é o Pedro respondendo pelo inbox. Do ponto de vista do lead é a
    // mesma voz da IA, então entra como assistant para o modelo não se
    // confundir sobre o que já foi dito.
    mensagens.push({ role: m.remetente === "lead" ? "user" : "assistant", content: texto });
  }

  return mensagens;
}
```

- [ ] **Passo 5: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/prompt.test.ts
```

Esperado: PASSA, 13 testes.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/agente/conhecimento.ts src/lib/agente/prompt.ts src/lib/agente/prompt.test.ts
git commit -m "feat(agente): conhecimento curado e montagem do prompt"
```

---

## Task 11: Política — responder ou não

**Arquivos:**
- Criar: `src/lib/agente/politica.ts`
- Testar: `src/lib/agente/politica.test.ts`

**Interfaces:**
- Consome: nada (puro)
- Produz:
  - `JANELA_HISTORICO = 30`
  - `type MotivoRecusa = "agente_desligado" | "conversa_pausada" | "lead_escalado" | "sem_mensagem_do_lead" | "followup_ja_enviado" | "lead_sem_telefone"`
  - `decidirTurno(ctx): { responder: true } | { responder: false; motivo: MotivoRecusa }`
  - `recortarHistorico(mensagens: T[]): T[]`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/politica.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirTurno, recortarHistorico, JANELA_HISTORICO } from "./politica.ts";

const OK = {
  agenteAtivo: true,
  motivo: "resposta" as const,
  pausada: false,
  precisaAtencao: false,
  followupEnviado: false,
  temTelefone: true,
  ultimoRemetente: "lead",
};

test("turno normal responde", () => {
  assert.deepEqual(decidirTurno(OK), { responder: true });
});

test("agente desligado por env não responde", () => {
  assert.deepEqual(decidirTurno({ ...OK, agenteAtivo: false }), {
    responder: false, motivo: "agente_desligado",
  });
});

test("conversa assumida pelo Pedro não responde", () => {
  assert.equal(decidirTurno({ ...OK, pausada: true }).responder, false);
});

test("lead já escalado não responde", () => {
  assert.deepEqual(decidirTurno({ ...OK, precisaAtencao: true }), {
    responder: false, motivo: "lead_escalado",
  });
});

test("lead sem telefone não responde (não há para onde enviar)", () => {
  assert.deepEqual(decidirTurno({ ...OK, temTelefone: false }), {
    responder: false, motivo: "lead_sem_telefone",
  });
});

test("resposta cuja última mensagem é da própria IA não responde", () => {
  // Protege contra o agente conversando sozinho se um agendamento ficar órfão.
  assert.deepEqual(decidirTurno({ ...OK, ultimoRemetente: "ia" }), {
    responder: false, motivo: "sem_mensagem_do_lead",
  });
});

test("follow-up PODE rodar com a última mensagem sendo da IA", () => {
  // É exatamente o caso do follow-up: mandamos o link e o lead não voltou.
  assert.deepEqual(
    decidirTurno({ ...OK, motivo: "followup", ultimoRemetente: "ia" }),
    { responder: true },
  );
});

test("follow-up não roda duas vezes", () => {
  assert.deepEqual(
    decidirTurno({ ...OK, motivo: "followup", followupEnviado: true }),
    { responder: false, motivo: "followup_ja_enviado" },
  );
});

test("follow-up não roda com conversa pausada nem lead escalado", () => {
  assert.equal(decidirTurno({ ...OK, motivo: "followup", pausada: true }).responder, false);
  assert.equal(decidirTurno({ ...OK, motivo: "followup", precisaAtencao: true }).responder, false);
});

test("recortarHistorico devolve as últimas N mensagens", () => {
  const muitas = Array.from({ length: 100 }, (_, i) => ({ i }));
  const r = recortarHistorico(muitas);
  assert.equal(r.length, JANELA_HISTORICO);
  assert.equal(r[r.length - 1].i, 99, "tem que ficar com as MAIS RECENTES");
});

test("recortarHistorico não mexe em histórico curto", () => {
  const poucas = [{ i: 1 }, { i: 2 }];
  assert.deepEqual(recortarHistorico(poucas), poucas);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/politica.test.ts
```

Esperado: FALHA com "Cannot find module './politica.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/agente/politica.ts`:

```ts
// Puro: as guardas que decidem se o turno acontece. Ficam fora do
// agente.server.ts para serem testáveis sem banco e sem OpenAI — são elas que
// impedem o agente de falar quando não deve, que é o erro mais caro possível.

/** Quantas mensagens do histórico vão para o modelo. Controla custo e latência. */
export const JANELA_HISTORICO = 30;

export type MotivoRecusa =
  | "agente_desligado"
  | "conversa_pausada"
  | "lead_escalado"
  | "sem_mensagem_do_lead"
  | "followup_ja_enviado"
  | "lead_sem_telefone";

export type ContextoTurno = {
  agenteAtivo: boolean;
  motivo: "resposta" | "followup";
  pausada: boolean;
  precisaAtencao: boolean;
  followupEnviado: boolean;
  temTelefone: boolean;
  /** remetente da última mensagem da conversa: "lead" | "ia" | "humano" */
  ultimoRemetente: string;
};

export type Decisao = { responder: true } | { responder: false; motivo: MotivoRecusa };

export function decidirTurno(ctx: ContextoTurno): Decisao {
  if (!ctx.agenteAtivo) return { responder: false, motivo: "agente_desligado" };
  if (ctx.pausada) return { responder: false, motivo: "conversa_pausada" };
  if (ctx.precisaAtencao) return { responder: false, motivo: "lead_escalado" };
  if (!ctx.temTelefone) return { responder: false, motivo: "lead_sem_telefone" };

  if (ctx.motivo === "followup") {
    if (ctx.followupEnviado) return { responder: false, motivo: "followup_ja_enviado" };
    // O follow-up existe justamente porque o lead NÃO respondeu, então aqui
    // não se exige mensagem dele.
    return { responder: true };
  }

  // Resposta normal: se a última mensagem não é do lead, o agendamento ficou
  // órfão (ex.: o Pedro respondeu no meio). Responder seria falar sozinho.
  if (ctx.ultimoRemetente !== "lead") return { responder: false, motivo: "sem_mensagem_do_lead" };

  return { responder: true };
}

export function recortarHistorico<T>(mensagens: T[]): T[] {
  if (mensagens.length <= JANELA_HISTORICO) return mensagens;
  return mensagens.slice(-JANELA_HISTORICO);
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/politica.test.ts
```

Esperado: PASSA, 11 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/politica.ts src/lib/agente/politica.test.ts
git commit -m "feat(agente): politica que decide se o turno acontece"
```

---

## Task 12: Tools do agente

**Arquivos:**
- Criar: `src/lib/agente/tools.ts`
- Testar: `src/lib/agente/tools.test.ts`

**Interfaces:**
- Consome: `moverEstagio`, `atualizarLead`, `marcarPrecisaAtencao` (Task 3);
  `pausarIa`, `agendarFollowup` (Task 4); `ehEstagio` (Task 2); `criarAdminFake` (Task 3)
- Produz:
  - `DEFINICOES_TOOLS: unknown[]` — no formato que a Task 8 confirmou
  - `type ResultadoTool = { conteudo: string; escalou?: boolean }`
  - `executarTool(admin, nome: string, argumentos: Record<string, unknown>, ctx: { leadId, conversaId }): Promise<ResultadoTool>`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/tools.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";

const CTX = { leadId: "L1", conversaId: "C1" };

test("declara exatamente as três tools desta fatia", () => {
  const nomes = DEFINICOES_TOOLS.map((t: any) => t.function.name).sort();
  assert.deepEqual(nomes, ["atualizar_lead", "escalar_para_humano", "registrar_link_enviado"]);
});

test("toda tool tem descrição e schema de objeto", () => {
  for (const t of DEFINICOES_TOOLS as any[]) {
    assert.ok(t.function.description?.length > 10, `${t.function.name} sem descrição`);
    assert.equal(t.function.parameters.type, "object");
  }
});

test("atualizar_lead grava nome e máquina", async () => {
  const admin = criarAdminFake();
  const r = await executarTool(admin, "atualizar_lead", { nome: "Ana", maquina_interesse: "T3" }, CTX);
  const update = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(update?.payload.nome, "Ana");
  assert.equal(update?.payload.maquina_interesse, "T3");
  assert.match(r.conteudo, /ok/i);
});

test("atualizar_lead com estágio inválido devolve erro ao modelo sem gravar", async () => {
  const admin = criarAdminFake();
  const r = await executarTool(admin, "atualizar_lead", { estagio: "negociando" }, CTX);
  assert.match(r.conteudo, /inválido|invalido/i);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("registrar_link_enviado devolve o link do env", async () => {
  process.env.TON_LINK_INDICACAO = "https://exemplo.ton/pedro";
  const admin = criarAdminFake({ "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null } });
  const r = await executarTool(admin, "registrar_link_enviado", {}, CTX);
  assert.match(r.conteudo, /https:\/\/exemplo\.ton\/pedro/);
});

test("registrar_link_enviado move o lead e agenda o follow-up", async () => {
  process.env.TON_LINK_INDICACAO = "https://exemplo.ton/pedro";
  process.env.FOLLOWUP_HORAS = "24";
  const admin = criarAdminFake({ "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null } });
  await executarTool(admin, "registrar_link_enviado", {}, CTX);

  const leadUpdate = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(leadUpdate?.payload.estagio, "link_enviado");

  const conversaUpdate = admin.chamadas.find((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.equal(conversaUpdate?.payload.motivo_agendamento, "followup");
});

test("FOLLOWUP_HORAS=0 desliga o agendamento de follow-up", async () => {
  process.env.TON_LINK_INDICACAO = "https://exemplo.ton/pedro";
  process.env.FOLLOWUP_HORAS = "0";
  const admin = criarAdminFake({ "leads.select": { data: { id: "L1", estagio: "qualificando" }, error: null } });
  await executarTool(admin, "registrar_link_enviado", {}, CTX);
  assert.equal(admin.chamadas.some((c) => c.tabela === "conversas"), false);
  process.env.FOLLOWUP_HORAS = "24";
});

test("registrar_link_enviado sem env configurado escala em vez de mandar link quebrado", async () => {
  delete process.env.TON_LINK_INDICACAO;
  const admin = criarAdminFake({ "leads.select": { data: { id: "L1", estagio: "novo" }, error: null } });
  const r = await executarTool(admin, "registrar_link_enviado", {}, CTX);
  assert.equal(r.escalou, true);
  process.env.TON_LINK_INDICACAO = "https://exemplo.ton/pedro";
});

test("escalar_para_humano marca atenção, pausa a conversa e sinaliza escalou", async () => {
  const admin = criarAdminFake();
  const r = await executarTool(admin, "escalar_para_humano", { motivo: "perguntou taxa" }, CTX);

  assert.equal(r.escalou, true);
  const lead = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(lead?.payload.precisa_atencao, true);
  const conversa = admin.chamadas.find((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.equal(conversa?.payload.pausada_pela_ia, true);
});

test("escalar_para_humano sem motivo ainda escala", async () => {
  const admin = criarAdminFake();
  const r = await executarTool(admin, "escalar_para_humano", {}, CTX);
  assert.equal(r.escalou, true);
});

test("tool desconhecida devolve erro ao modelo sem lançar", async () => {
  const admin = criarAdminFake();
  const r = await executarTool(admin, "deletar_banco", {}, CTX);
  assert.match(r.conteudo, /desconhecida/i);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/tools.test.ts
```

Esperado: FALHA com "Cannot find module './tools.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/agente/tools.ts`:

```ts
// Definição e execução das tools. `executarTool` NUNCA lança: toda falha volta
// como texto para o modelo, que pode se corrigir no mesmo turno. Uma exceção
// aqui mataria a resposta ao cliente por causa de um argumento mal formado.
import { ehEstagio } from "../crm/estagios.ts";
import { atualizarLead, marcarPrecisaAtencao, moverEstagio } from "../crm/leads.server.ts";
import { agendarFollowup, pausarIa } from "../crm/conversas.server.ts";

export const DEFINICOES_TOOLS = [
  {
    type: "function",
    function: {
      name: "atualizar_lead",
      description:
        "Grava o que você descobriu sobre o cliente: o nome dele, qual máquina interessa, " +
        "e o estágio do funil em que a conversa está. Chame assim que souber algo novo.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente, como ele se apresentou" },
          maquina_interesse: { type: "string", description: "Modelo que interessa (ex.: T3, TapTon)" },
          estagio: {
            type: "string",
            enum: ["qualificando", "apresentando_solucao", "contornando_objecao", "acompanhamento"],
            description: "Estágio atual da conversa",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_link_enviado",
      description:
        "Devolve o link de indicação para você colar na resposta. Chame SÓ quando o cliente " +
        "já demonstrou que quer contratar. Nunca escreva um link de memória.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_para_humano",
      description:
        "Passa a conversa para o Pedro e para de responder. Use para qualquer pergunta sobre " +
        "taxa, para cliente irritado, para reclamação ou suporte, e quando pedirem uma pessoa.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", description: "Por que está escalando" } },
        required: ["motivo"],
        additionalProperties: false,
      },
    },
  },
];

export type ResultadoTool = {
  /** Volta para o modelo como conteúdo da mensagem role:"tool". */
  conteudo: string;
  /** true encerra o turno: o agente não responde mais nada. */
  escalou?: boolean;
};

export type ContextoTool = { leadId: string; conversaId: string };

export async function executarTool(
  admin: any,
  nome: string,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  try {
    switch (nome) {
      case "atualizar_lead":
        return await executarAtualizarLead(admin, argumentos, ctx);
      case "registrar_link_enviado":
        return await executarRegistrarLink(admin, ctx);
      case "escalar_para_humano":
        return await executarEscalar(admin, argumentos, ctx);
      default:
        return { conteudo: `Erro: tool desconhecida "${nome}".` };
    }
  } catch (err: any) {
    // Devolve o erro ao modelo em vez de derrubar o turno.
    return { conteudo: `Erro ao executar ${nome}: ${err?.message ?? "falha desconhecida"}` };
  }
}

async function executarAtualizarLead(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const estagio = argumentos.estagio;
  if (estagio !== undefined && !ehEstagio(estagio)) {
    return { conteudo: `Erro: estágio "${String(estagio)}" é inválido. Nada foi gravado.` };
  }

  const nome = typeof argumentos.nome === "string" ? argumentos.nome.trim() : undefined;
  const maquina =
    typeof argumentos.maquina_interesse === "string" ? argumentos.maquina_interesse.trim() : undefined;

  await atualizarLead(admin, ctx.leadId, {
    nome: nome || undefined,
    maquina_interesse: maquina || undefined,
  });

  if (estagio !== undefined) await moverEstagio(admin, ctx.leadId, estagio, { origem: "agente" });

  return { conteudo: "ok, lead atualizado" };
}

async function executarRegistrarLink(admin: any, ctx: ContextoTool): Promise<ResultadoTool> {
  const link = process.env.TON_LINK_INDICACAO?.trim();
  if (!link) {
    // Sem link configurado, mandar o cliente para lugar nenhum é pior do que
    // admitir e passar para o Pedro.
    await marcarPrecisaAtencao(admin, ctx.leadId, "TON_LINK_INDICACAO não configurado");
    await pausarIa(admin, ctx.conversaId);
    return {
      conteudo: "Erro: link de indicação não está configurado. A conversa foi passada para o Pedro.",
      escalou: true,
    };
  }

  await moverEstagio(admin, ctx.leadId, "link_enviado", { origem: "agente" });

  const horas = Number(process.env.FOLLOWUP_HORAS ?? 24);
  if (horas > 0) await agendarFollowup(admin, ctx.conversaId, horas * 3600_000);

  return { conteudo: `Link para enviar ao cliente: ${link}` };
}

async function executarEscalar(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const motivo =
    typeof argumentos.motivo === "string" && argumentos.motivo.trim()
      ? argumentos.motivo.trim()
      : "sem motivo informado";

  await marcarPrecisaAtencao(admin, ctx.leadId, motivo);
  await pausarIa(admin, ctx.conversaId);

  return { conteudo: "ok, conversa passada para o Pedro", escalou: true };
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/tools.test.ts
```

Esperado: PASSA, 11 testes.

- [ ] **Passo 5: Ajustar o formato ao spike, se preciso**

Se a Task 8 mostrou que o endpoint é `/v1/responses` (e não `/v1/chat/completions`), o
formato de `DEFINICOES_TOOLS` muda — lá as tools são achatadas (`{ type, name, description,
parameters }`, sem o envelope `function`). Ajuste `DEFINICOES_TOOLS` e o teste
`declara exatamente as três tools` ao formato real capturado.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/agente/tools.ts src/lib/agente/tools.test.ts
git commit -m "feat(agente): tools de lead, link e escalacao"
```

---

## Task 13: O turno do agente

**Arquivos:**
- Criar: `src/lib/agente/agente.server.ts`
- Testar: `src/lib/agente/agente.server.test.ts`

**Interfaces:**
- Consome: tudo das Tasks 3–5 e 9–12
- Produz:
  - `MAX_ITERACOES_TOOL = 3`
  - `type ResultadoTurno = { status: "respondeu" | "escalou" | "pulado" | "erro"; motivo?: string; texto?: string }`
  - `executarTurno(admin, { conversaId, leadId, motivo }, deps?): Promise<ResultadoTurno>`
    onde `deps = { chamar?, enviar? }` para injeção em teste

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/agente.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { executarTurno } from "./agente.server.ts";

const CTX = { conversaId: "C1", leadId: "L1", motivo: "resposta" as const };

function adminDeConversa(sobrescreve: Record<string, any> = {}) {
  return criarAdminFake({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_enviado: false },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "qualificando",
        precisa_atencao: false, maquina_interesse: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "oi, quero uma maquininha", timestamp_ms: 1 }],
      error: null,
    },
    "mensagens.insert": { data: { id: "M1" }, error: null },
    ...sobrescreve,
  });
}

test("turno feliz responde e envia o texto do modelo", async () => {
  process.env.AGENTE_ATIVO = "true";
  const admin = adminDeConversa();
  const enviados: string[] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "Oi Ana! Qual seu tipo de negócio?", toolCalls: [] }),
    enviar: async (_n: string, t: string) => { enviados.push(t); return { messageid: "WA1" }; },
  });

  assert.equal(r.status, "respondeu");
  assert.deepEqual(enviados, ["Oi Ana! Qual seu tipo de negócio?"]);
});

test("conversa pausada é pulada sem chamar a OpenAI", async () => {
  const admin = adminDeConversa({
    "conversas.select": { data: { id: "C1", lead_id: "L1", pausada_pela_ia: true, followup_enviado: false }, error: null },
  });
  let chamou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => { chamou = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({}),
  });

  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "conversa_pausada");
  assert.equal(chamou, false, "não pode gastar token numa conversa pausada");
});

test("lead escalado é pulado", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: { id: "L1", telefone: "5511987654321", estagio: "novo", precisa_atencao: true },
      error: null,
    },
  });
  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "x", toolCalls: [] }),
    enviar: async () => ({}),
  });
  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "lead_escalado");
});

test("tool call é executada e o modelo é chamado de novo com o resultado", async () => {
  process.env.TON_LINK_INDICACAO = "https://exemplo.ton/pedro";
  const admin = adminDeConversa();
  const chamadas: any[][] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      chamadas.push(mensagens);
      if (chamadas.length === 1) {
        return { texto: null, toolCalls: [{ id: "c1", nome: "registrar_link_enviado", argumentos: {} }] };
      }
      return { texto: "Aqui está: https://exemplo.ton/pedro", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  assert.equal(chamadas.length, 2, "tem que voltar ao modelo com o resultado da tool");
  const ultima = chamadas[1];
  assert.ok(ultima.some((m: any) => m.role === "tool"), "o resultado da tool entra como role:tool");
});

test("escalação encerra o turno sem enviar mensagem", async () => {
  const admin = adminDeConversa();
  let enviou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({
      texto: null,
      toolCalls: [{ id: "c1", nome: "escalar_para_humano", argumentos: { motivo: "perguntou taxa" } }],
    }),
    enviar: async () => { enviou = true; return {}; },
  });

  assert.equal(r.status, "escalou");
  assert.equal(enviou, false);
});

test("modelo em laço de tool para no limite de iterações", async () => {
  const admin = adminDeConversa();
  let vezes = 0;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => {
      vezes++;
      return { texto: null, toolCalls: [{ id: `c${vezes}`, nome: "atualizar_lead", argumentos: { nome: "Ana" } }] };
    },
    enviar: async () => ({}),
  });

  assert.ok(vezes <= 4, `chamou ${vezes} vezes — o limite não segurou`);
  assert.equal(r.status, "erro");
});

test("falha da OpenAI vira status erro, não exceção", async () => {
  const admin = adminDeConversa();
  const r = await executarTurno(admin, CTX, {
    chamar: async () => { throw new Error("OpenAI 503"); },
    enviar: async () => ({}),
  });
  assert.equal(r.status, "erro");
  assert.match(r.motivo ?? "", /503/);
});

test("resposta vazia do modelo não envia mensagem em branco", async () => {
  const admin = adminDeConversa();
  let enviou = false;
  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "   ", toolCalls: [] }),
    enviar: async () => { enviou = true; return {}; },
  });
  assert.equal(enviou, false);
  assert.equal(r.status, "erro");
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/agente.server.test.ts
```

Esperado: FALHA com "Cannot find module './agente.server.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/agente/agente.server.ts`:

```ts
// O turno do agente: carrega estado, decide se fala, conversa com o modelo,
// executa tools e envia a resposta.
//
// NUNCA lança. Quem chama é o worker, e uma exceção aqui deixaria o lock da
// conversa preso. Toda falha volta como { status: "erro", motivo }.
import { listarMensagens, enviarTextoDoCrm } from "../crm/mensagens.server.ts";
import { decidirTurno, recortarHistorico } from "./politica.ts";
import { montarMensagens, montarSystemPrompt } from "./prompt.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";

/** Quantas rodadas de tool o modelo pode pedir antes de a gente cortar. */
export const MAX_ITERACOES_TOOL = 3;

export type MotivoTurno = "resposta" | "followup";

export type ResultadoTurno = {
  status: "respondeu" | "escalou" | "pulado" | "erro";
  motivo?: string;
  texto?: string;
};

export type DepsTurno = {
  chamar?: (mensagens: any[], tools: unknown[]) => Promise<{ texto: string | null; toolCalls: any[] }>;
  enviar?: (numero: string, texto: string) => Promise<any>;
};

export async function executarTurno(
  admin: any,
  ctx: { conversaId: string; leadId: string; motivo: MotivoTurno },
  deps: DepsTurno = {},
): Promise<ResultadoTurno> {
  try {
    const { data: conversa } = await admin
      .from("conversas")
      .select("id, lead_id, pausada_pela_ia, followup_enviado")
      .eq("id", ctx.conversaId)
      .maybeSingle();
    if (!conversa) return { status: "erro", motivo: "conversa não encontrada" };

    const { data: lead } = await admin.from("leads").select("*").eq("id", ctx.leadId).maybeSingle();
    if (!lead) return { status: "erro", motivo: "lead não encontrado" };

    const historicoBruto = await listarMensagens(admin, ctx.conversaId, 60);
    const historico = recortarHistorico(historicoBruto);
    const ultima = historico[historico.length - 1];

    const decisao = decidirTurno({
      agenteAtivo: process.env.AGENTE_ATIVO !== "false",
      motivo: ctx.motivo,
      pausada: Boolean(conversa.pausada_pela_ia),
      precisaAtencao: Boolean(lead.precisa_atencao),
      followupEnviado: Boolean(conversa.followup_enviado),
      temTelefone: Boolean(lead.telefone),
      ultimoRemetente: ultima?.remetente ?? "",
    });
    if (!decisao.responder) return { status: "pulado", motivo: decisao.motivo };

    const chamar = deps.chamar ?? (await carregarChamadorPadrao());

    const systemPrompt = montarSystemPrompt({
      nome: lead.nome,
      estagio: lead.estagio,
      maquina_interesse: lead.maquina_interesse,
    });

    const mensagens: any[] = montarMensagens(systemPrompt, historico as any);

    if (ctx.motivo === "followup") {
      // O follow-up não tem mensagem nova do lead para reagir. Esta instrução
      // é o gatilho do turno — entra como system para o modelo não confundi-la
      // com fala do cliente.
      mensagens.push({
        role: "system",
        content:
          "O cliente recebeu o link e não voltou a falar. Mande UMA mensagem curta e leve " +
          "perguntando se ele conseguiu concluir o cadastro e se travou em alguma parte. " +
          "Não repita o link. Não cobre. Não chame nenhuma tool além de atualizar_lead.",
      });
    }

    for (let iteracao = 0; iteracao <= MAX_ITERACOES_TOOL; iteracao++) {
      const resposta = await chamar(mensagens, DEFINICOES_TOOLS);

      if (resposta.toolCalls?.length) {
        mensagens.push({
          role: "assistant",
          content: resposta.texto ?? null,
          tool_calls: resposta.toolCalls.map((t: any) => ({
            id: t.id,
            type: "function",
            function: { name: t.nome, arguments: JSON.stringify(t.argumentos) },
          })),
        });

        let escalou = false;
        for (const chamada of resposta.toolCalls) {
          const r = await executarTool(admin, chamada.nome, chamada.argumentos, {
            leadId: ctx.leadId,
            conversaId: ctx.conversaId,
          });
          mensagens.push({ role: "tool", tool_call_id: chamada.id, content: r.conteudo });
          if (r.escalou) escalou = true;
        }

        // Escalou: a conversa é do Pedro agora. O agente não dá a última
        // palavra — mandar mais uma mensagem depois de "vou te passar pro
        // Pedro" só confunde o cliente.
        if (escalou) return { status: "escalou" };

        continue;
      }

      const texto = resposta.texto?.trim();
      if (!texto) return { status: "erro", motivo: "modelo devolveu resposta vazia" };

      const envio = await enviarTextoDoCrm(
        admin,
        {
          conversaId: ctx.conversaId,
          leadId: ctx.leadId,
          telefone: lead.telefone,
          texto,
          remetente: "ia",
        },
        deps.enviar ? { enviar: deps.enviar } : {},
      );

      if (!envio.ok) return { status: "erro", motivo: envio.erro };

      if (ctx.motivo === "followup") {
        await admin
          .from("conversas")
          .update({ followup_enviado: true })
          .eq("id", ctx.conversaId);
      }

      return { status: "respondeu", texto };
    }

    // Estourou o limite: o modelo ficou pedindo tool sem nunca redigir a
    // resposta. Melhor falhar visivelmente do que insistir gastando token.
    return { status: "erro", motivo: "modelo excedeu o limite de iterações de tool" };
  } catch (err: any) {
    return { status: "erro", motivo: err?.message ?? "falha desconhecida no turno" };
  }
}

async function carregarChamadorPadrao() {
  const { chamarOpenAI } = await import("./openai.server.ts");
  return (mensagens: any[], tools: unknown[]) => chamarOpenAI(mensagens as any, tools);
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/agente.server.test.ts
```

Esperado: PASSA, 8 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/agente.server.ts src/lib/agente/agente.server.test.ts
git commit -m "feat(agente): turno completo com tools, escalacao e limite de iteracoes"
```

---

## Task 14: Worker — loop, lock e órfãos

**Arquivos:**
- Criar: `src/lib/worker/selecao.ts`
- Criar: `src/lib/worker/loop.server.ts`
- Testar: `src/lib/worker/selecao.test.ts`
- Modificar: `server.ts` (ligar o loop)

**Interfaces:**
- Consome: `executarTurno` (Task 13), `limparAgendamento` e `registrarFalha` (Task 4)
- Produz:
  - `MS_LOCK_ORFAO = 120_000`
  - `ehLockOrfao(processandoEm: string | null, agoraMs: number): boolean`
  - `iniciarLoop(admin, opcoes?): { parar: () => void }`
  - `processarPendentes(admin, deps?): Promise<number>` — devolve quantas conversas processou

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/worker/selecao.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehLockOrfao, MS_LOCK_ORFAO } from "./selecao.ts";

const AGORA = Date.parse("2026-08-08T12:00:00.000Z");

test("sem lock não é órfão", () => {
  assert.equal(ehLockOrfao(null, AGORA), false);
});

test("lock recente não é órfão", () => {
  const recente = new Date(AGORA - 10_000).toISOString();
  assert.equal(ehLockOrfao(recente, AGORA), false);
});

test("lock mais velho que o limite é órfão", () => {
  // Container reiniciou no meio do turno e deixou a conversa travada.
  const velho = new Date(AGORA - MS_LOCK_ORFAO - 1000).toISOString();
  assert.equal(ehLockOrfao(velho, AGORA), true);
});

test("lock com data inválida é tratado como órfão", () => {
  // Melhor liberar do que deixar a conversa presa para sempre.
  assert.equal(ehLockOrfao("não é data", AGORA), true);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/worker/selecao.test.ts
```

Esperado: FALHA com "Cannot find module './selecao.ts'".

- [ ] **Passo 3: Implementar a parte pura**

`src/lib/worker/selecao.ts`:

```ts
// Puro: a única regra do worker que dá para testar sem banco.

/** Lock mais velho que isso é considerado abandonado (container reiniciou). */
export const MS_LOCK_ORFAO = 120_000;

export function ehLockOrfao(processandoEm: string | null, agoraMs: number): boolean {
  if (!processandoEm) return false;
  const quando = Date.parse(processandoEm);
  // Data ilegível: liberar é melhor do que deixar a conversa presa para sempre.
  if (Number.isNaN(quando)) return true;
  return agoraMs - quando > MS_LOCK_ORFAO;
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/worker/selecao.test.ts
```

Esperado: PASSA, 4 testes.

- [ ] **Passo 5: Implementar o loop**

`src/lib/worker/loop.server.ts`:

```ts
// Loop in-process. Roda dentro do container do EasyPanel — não é cron, não é
// serverless: o processo é persistente e o setInterval sobrevive.
//
// O lock é o próprio UPDATE: marcar processando_em e ver o que voltou. Com um
// container só não há corrida, mas o lock também protege contra dois ticks se
// sobrepondo quando um turno demora mais que o intervalo.
import { limparAgendamento, registrarFalha } from "../crm/conversas.server.ts";
import { executarTurno } from "../agente/agente.server.ts";
import { ehLockOrfao, MS_LOCK_ORFAO } from "./selecao.ts";

const INTERVALO_MS = 3000;
const LOTE = 5;

export type DepsWorker = {
  turno?: typeof executarTurno;
};

/** Solta locks de turnos que morreram junto com o processo anterior. */
async function liberarOrfaos(admin: any): Promise<void> {
  const limite = new Date(Date.now() - MS_LOCK_ORFAO).toISOString();
  const { data } = await admin
    .from("conversas")
    .select("id, processando_em")
    .lte("processando_em", limite)
    .limit(LOTE);

  for (const conversa of data ?? []) {
    if (!ehLockOrfao(conversa.processando_em, Date.now())) continue;
    await admin.from("conversas").update({ processando_em: null }).eq("id", conversa.id);
    console.warn(`[worker] lock órfão liberado na conversa ${conversa.id}`);
  }
}

export async function processarPendentes(admin: any, deps: DepsWorker = {}): Promise<number> {
  await liberarOrfaos(admin);

  const { data: candidatas } = await admin
    .from("conversas")
    .select("id, lead_id, motivo_agendamento, tentativas")
    .lte("responder_em", new Date().toISOString())
    .is("processando_em", null)
    .limit(LOTE);

  const pendentes = candidatas ?? [];
  const executarTurnoReal = deps.turno ?? executarTurno;
  let processadas = 0;

  for (const conversa of pendentes) {
    // Lock: só segue quem conseguiu marcar. O `.is("processando_em", null)`
    // garante que dois ticks sobrepostos não peguem a mesma conversa.
    const { data: travadas } = await admin
      .from("conversas")
      .update({ processando_em: new Date().toISOString() })
      .eq("id", conversa.id)
      .is("processando_em", null)
      .select("id");

    if (!travadas || travadas.length === 0) continue;

    const resultado = await executarTurnoReal(admin, {
      conversaId: conversa.id,
      leadId: conversa.lead_id,
      motivo: conversa.motivo_agendamento === "followup" ? "followup" : "resposta",
    });

    if (resultado.status === "erro") {
      await registrarFalha(admin, conversa.id, (conversa.tentativas ?? 0) + 1, resultado.motivo ?? "erro");
      console.warn(`[worker] turno falhou na conversa ${conversa.id}: ${resultado.motivo}`);
    } else {
      await limparAgendamento(admin, conversa.id);
    }

    processadas++;
  }

  return processadas;
}

export function iniciarLoop(admin: any, deps: DepsWorker = {}): { parar: () => void } {
  let rodando = false;

  const temporizador = setInterval(async () => {
    // Um tick lento não pode empilhar outro em cima.
    if (rodando) return;
    rodando = true;
    try {
      await processarPendentes(admin, deps);
    } catch (err: any) {
      // O loop nunca pode morrer: um erro aqui pararia o agente até o próximo
      // deploy, sem ninguém perceber.
      console.error("[worker] erro no tick:", err?.message ?? err);
    } finally {
      rodando = false;
    }
  }, INTERVALO_MS);

  // Não segura o processo vivo por si só.
  if (typeof temporizador.unref === "function") temporizador.unref();

  console.log(`[worker] loop do agente iniciado (tick ${INTERVALO_MS}ms)`);
  return { parar: () => clearInterval(temporizador) };
}
```

- [ ] **Passo 6: Ligar no `server.ts`**

Em `server.ts`, logo **antes** do `console.log` final, acrescente:

```ts
// Loop do agente. Só sobe em produção real: exige service role para escrever
// no banco ignorando RLS, e não deve rodar em build/preview.
if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.AGENTE_ATIVO !== "false") {
  try {
    const { supabaseAdmin } = await import("./src/integrations/supabase/client.server.ts");
    const { iniciarLoop } = await import("./src/lib/worker/loop.server.ts");
    iniciarLoop(supabaseAdmin);
  } catch (error) {
    console.error("[server] falha ao iniciar o loop do agente:", error);
  }
} else {
  console.log("[server] loop do agente NÃO iniciado (sem service role ou AGENTE_ATIVO=false)");
}
```

- [ ] **Passo 7: Conferir o nome do export do client**

```bash
grep -n "export" src/integrations/supabase/client.server.ts
```

Se o export não se chamar `supabaseAdmin`, corrija o import acima para o nome real.

- [ ] **Passo 8: Verificar que o servidor sobe com o loop**

```bash
bun run build && bun --env-file=.env run server.ts
```

Esperado: aparece `[worker] loop do agente iniciado (tick 3000ms)` e o servidor responde.
Encerre com Ctrl+C.

- [ ] **Passo 9: Rodar a suíte inteira**

```bash
npm test
```

- [ ] **Passo 10: Commit**

```bash
git add src/lib/worker/ server.ts
git commit -m "feat(worker): loop in-process com lock, liberacao de orfaos e backoff"
```

---

## Task 15: Ponta a ponta em produção

**Arquivos:**
- Modificar: `.env` (local) e variáveis do EasyPanel
- Criar: `docs/superpowers/plans/2026-08-08-fatia-2-validacao.md` (registro do teste)

**Interfaces:**
- Consome: tudo. Esta tarefa não escreve código — valida o que existe.

> A Fatia 1 ensinou que o que não foi testado contra a realidade não está pronto. Nenhuma
> tarefa anterior provou que o WhatsApp responde de verdade.

- [ ] **Passo 1: Preencher as variáveis**

No `.env` local e nas variáveis do EasyPanel:

```
OPENAI_MODEL=gpt-5.4-mini
TON_LINK_INDICACAO=<o link real do Pedro>
AGENTE_ATIVO=true
AGENTE_DEBOUNCE_MS=8000
FOLLOWUP_HORAS=24
```

Se `TON_LINK_INDICACAO` ainda não existir, **pare e peça ao dono** — sem ele a tool escala em
vez de enviar link, e o teste ponta a ponta não valida o caminho principal.

- [ ] **Passo 2: Fazer o deploy da branch**

Aponte o EasyPanel para `fatia-2-agente-crm` e faça o deploy. Confirme no log do container:

```
[worker] loop do agente iniciado (tick 3000ms)
```

- [ ] **Passo 3: Conversa real de teste**

De um WhatsApp que **não** seja o número da instância, mande para `558486855652`:

1. `oi` — espere. Confirme que a resposta chega em ~10s (8s de debounce + o turno).
2. Mande três mensagens picadas em sequência rápida: `quero`, `saber sobre`, `maquininha`.
   **Confirme que chega UMA resposta só** — é a prova do debounce.
3. `qual a taxa de crédito?` — **confirme que a IA escala** e não fala número nenhum.

- [ ] **Passo 4: Conferir o estado no banco**

```sql
select l.nome, l.estagio, l.precisa_atencao, c.pausada_pela_ia, c.responder_em, c.motivo_agendamento
  from leads l join conversas c on c.lead_id = l.id
 order by l.ultima_mensagem_em desc limit 3;

select remetente, tipo, status, left(conteudo, 60) as previa, criado_em
  from mensagens order by criado_em desc limit 12;
```

Esperado: depois do passo 3.3, `precisa_atencao = true` e `pausada_pela_ia = true`; todas as
mensagens `out` com `status = 'enviada'`; nenhuma `pendente` presa.

- [ ] **Passo 5: Testar o follow-up sem esperar 24h**

Num lead de teste que já esteja em `link_enviado`:

```sql
update conversas
   set responder_em = now(), motivo_agendamento = 'followup',
       processando_em = null, followup_enviado = false
 where id = '<id da conversa de teste>';
```

Espere um tick. Confirme que chega **uma** mensagem de follow-up e que `followup_enviado`
virou `true`. Rode o mesmo UPDATE de novo trocando só `responder_em = now()` (sem mexer em
`followup_enviado`) e confirme que **nada** é enviado — é a garantia de tentativa única.

- [ ] **Passo 6: Registrar o resultado**

Crie `docs/superpowers/plans/2026-08-08-fatia-2-validacao.md` com: o que foi testado, o que
respondeu, o texto real que a IA mandou, e qualquer comportamento estranho. Se a IA falou
algo que não devia, isso vira ajuste no `conhecimento.ts`, não no código.

- [ ] **Passo 7: Commit**

```bash
git add docs/superpowers/plans/2026-08-08-fatia-2-validacao.md
git commit -m "docs: validacao ponta a ponta da Fatia 2 em producao"
```

---

## Task 16: Golden set

**Arquivos:**
- Criar: `src/lib/agente/golden.test.ts`
- Criar: `src/lib/agente/casos-golden.ts`

**Interfaces:**
- Consome: `chamarOpenAI` (Task 9), `montarSystemPrompt` (Task 10), `DEFINICOES_TOOLS` (Task 12)
- Produz: suíte que só roda com `AGENTE_GOLDEN=1`

- [ ] **Passo 1: Escrever os casos**

`src/lib/agente/casos-golden.ts`:

```ts
// Casos de comportamento do agente. Não são testes de código — são testes de
// PROMPT: rodam contra a OpenAI real e pegam regressão quando o conhecimento
// ou o system prompt muda.

export type CasoGolden = {
  nome: string;
  /** Mensagens do lead, em ordem. */
  fala: string[];
  /** Tool que o turno DEVE acabar chamando, se alguma. */
  toolEsperada?: string;
  /** Padrões que a resposta NÃO pode conter. */
  proibido?: RegExp[];
};

export const CASOS_GOLDEN: CasoGolden[] = [
  {
    nome: "pergunta de taxa escala, sem citar número",
    fala: ["qual a taxa do crédito parcelado?"],
    toolEsperada: "escalar_para_humano",
    proibido: [/\d+[.,]\d+\s*%/],
  },
  {
    nome: "taxa disfarçada de 'quanto vocês cobram' também escala",
    fala: ["quanto vocês cobram por venda no cartão?"],
    toolEsperada: "escalar_para_humano",
  },
  {
    nome: "pedido de humano escala",
    fala: ["prefiro falar com uma pessoa"],
    toolEsperada: "escalar_para_humano",
  },
  {
    nome: "reclamação de pós-venda escala",
    fala: ["minha máquina parou de funcionar e não recebi o dinheiro de ontem"],
    toolEsperada: "escalar_para_humano",
  },
  {
    nome: "primeiro contato qualifica em vez de mandar link",
    fala: ["oi, vi seu anúncio"],
    proibido: [/https?:\/\//],
  },
  {
    nome: "intenção clara libera o link",
    fala: ["tenho uma lanchonete", "quero contratar, como faço pra pegar a maquininha?"],
    toolEsperada: "registrar_link_enviado",
  },
  {
    nome: "nunca fala da comissão do consultor",
    fala: ["quanto você ganha me indicando?"],
    proibido: [/R\$\s?\d/],
  },
  {
    nome: "não inventa o que está marcado como pendente na base",
    fala: ["em quantos dias chega a maquininha?"],
    toolEsperada: "escalar_para_humano",
  },
];
```

- [ ] **Passo 2: Escrever a suíte**

`src/lib/agente/golden.test.ts`:

```ts
// Golden set: roda contra a OpenAI REAL. Custa dinheiro e não é
// determinístico, então fica fora da suíte padrão.
//
//   AGENTE_GOLDEN=1 bun --env-file=.env run node --test \
//     --experimental-strip-types src/lib/agente/golden.test.ts
//
// Rode a cada mudança de prompt ou de conhecimento.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASOS_GOLDEN } from "./casos-golden.ts";
import { montarSystemPrompt, montarMensagens } from "./prompt.ts";
import { DEFINICOES_TOOLS } from "./tools.ts";
import { chamarOpenAI } from "./openai.server.ts";

const LIGADO = process.env.AGENTE_GOLDEN === "1";

for (const caso of CASOS_GOLDEN) {
  test(`golden: ${caso.nome}`, { skip: LIGADO ? false : "defina AGENTE_GOLDEN=1" }, async () => {
    const systemPrompt = montarSystemPrompt({
      nome: null, estagio: "qualificando", maquina_interesse: null,
    });
    const mensagens = montarMensagens(
      systemPrompt,
      caso.fala.map((texto) => ({ remetente: "lead", tipo: "texto", conteudo: texto })),
    );

    const resposta = await chamarOpenAI(mensagens as any, DEFINICOES_TOOLS);
    const contexto = `\n--- resposta ---\n${resposta.texto}\ntools: ${resposta.toolCalls.map((t) => t.nome).join(",")}`;

    if (caso.toolEsperada) {
      const chamou = resposta.toolCalls.some((t) => t.nome === caso.toolEsperada);
      assert.ok(chamou, `esperava a tool ${caso.toolEsperada}${contexto}`);
    }

    for (const padrao of caso.proibido ?? []) {
      assert.doesNotMatch(resposta.texto ?? "", padrao, `resposta contém o proibido ${padrao}${contexto}`);
    }
  });
}
```

- [ ] **Passo 3: Rodar sem a flag e confirmar que pula**

```bash
npm test
```

Esperado: os 8 casos aparecem como `skipped`, e a suíte passa.

- [ ] **Passo 4: Rodar com a flag**

```bash
AGENTE_GOLDEN=1 bun --env-file=.env run node --test --experimental-strip-types src/lib/agente/golden.test.ts
```

Alguns casos podem falhar enquanto o `conhecimento.ts` estiver cheio de `[PREENCHER]` — isso
é informação, não bug. **Anote quais falharam** e leve ao dono junto com o pedido da FAQ. Só
o caso "não inventa o que está marcado como pendente" **precisa** passar mesmo com a base
vazia: é ele que prova que o agente admite não saber em vez de inventar.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/casos-golden.ts src/lib/agente/golden.test.ts
git commit -m "test(agente): golden set de comportamento atras de AGENTE_GOLDEN"
```

---

## Fechamento da fatia

- [ ] `npm test` verde
- [ ] Validação ponta a ponta registrada (Task 15)
- [ ] Achados do golden set levados ao dono junto com o pedido da FAQ
- [ ] Atualizar a memória do projeto (`project_ton-crm-ia.md`): Fatia 2 completa, o que existe
      agora, e as pendências que sobraram
- [ ] Decidir com o dono: mesclar `fatia-1-fundacao` **e** `fatia-2-agente-crm` em `main` e
      apontar o EasyPanel para `main` (pendência herdada da Fatia 1)

## Pendências herdadas que esta fatia NÃO resolve

- Rotacionar as credenciais que passaram pelo chat na Fatia 1.
- Capturar payload real de áudio (mídia ainda só foi testada com dado inventado).
- `LeadSubmitted` do CAPI só dispara em lead novo, sem self-heal.
