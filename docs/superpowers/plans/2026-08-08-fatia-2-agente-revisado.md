# Fatia 2 (revisada) — Agente vendedor completo — Plano de Implementação

> **Para trabalhadores agênticos:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para implementar tarefa a tarefa. Os passos usam
> checkbox (`- [ ]`) para acompanhamento.

**Este plano SUBSTITUI as Tasks 10 a 16 de `2026-08-08-fatia-2-agente-crm.md`.**
As Tasks 1, 2, 3, 5 e 6 daquele plano estão implementadas e não se mexem. A Task 4
(`conversas.server.ts`) **nunca foi escrita** — ela é substituída pela Task 5 deste plano, que
entrega o arquivo completo (base + régua). As Tasks 7 (webhook agenda), 8 (spike da OpenAI) e
9 (cliente OpenAI) continuam valendo como estão no plano original e são **pré-requisito**.

**Objetivo:** transformar o agente de "qualifica e manda link" em **vendedor completo, do
primeiro contato ao pós-venda**: ele responde taxa com o número do documento, escolhe a
máquina certa pelo perfil, quebra objeção com o material oficial, manda o link de checkout do
produto certo, roda a régua de 4 toques da cadência oficial da Ton, acompanha o cliente depois
da compra tentando resolver antes de encaminhar, e respeita opt-out para sempre.

**Spec que manda:** `docs/superpowers/specs/2026-08-08-fatia-2-revisao-comercial.md` (adendo
comercial, aprovado pelo dono). Ele substitui o que conflitar em
`docs/superpowers/specs/2026-08-08-fatia-2-agente-crm-design.md`.

**Material de origem:** `docs/conhecimento/produtos-e-taxas.md`, `vendas-e-objecoes.md`,
`pos-venda-e-suporte.md`, `gerador-de-mensagens.md`.

**Stack:** TanStack Start 1.168, Supabase JS, Bun em produção, `node --test` para testes,
OpenAI via `fetch` puro (sem SDK — mesmo padrão de `capi.server.ts` e
`groq-transcribe.server.ts`).

---

## Restrições globais

- **Idioma:** todo identificador, comentário e mensagem de commit em português.
- **Loader ESM nativo:** todo import em módulo testado precisa de extensão `.ts` explícita
  (`from "./links.ts"`), e o alias `@/` **não resolve**. Módulos testáveis nunca importam
  `@/...` no topo — use import dinâmico dentro da função.
- **Suíte:** `npm test` roda `node --test --experimental-strip-types "src/**/*.test.ts"`. Só
  arquivos `*.test.ts` são coletados; helper de teste tem outro sufixo (`admin-fake.ts`).
- **`admin` por parâmetro:** nenhum módulo de `src/lib/crm/` ou `src/lib/agente/` cria client
  Supabase. Ele chega como primeiro argumento, tipado `any`.
- **Nunca lançar no caminho da mensagem:** falha de tool, de OpenAI ou de envio jamais derruba
  o turno. `try/catch` + retorno tipado, como já se faz no `ingest.server.ts`.
- **O modelo NUNCA escreve URL.** Ele só escolhe **qual produto**. A URL é montada por
  `links.ts` a partir do template + `TON_REFERRER` e devolvida pela tool
  `registrar_link_enviado`. Nenhuma URL de checkout/catálogo entra no system prompt.
- **Taxa é respondida** — com o número que está em `docs/conhecimento/produtos-e-taxas.md`, e
  só com ele. Faixa, modalidade ou bandeira que não estiver no conhecimento **escala**. Nunca
  arredondar, nunca estimar, nunca dizer "gira em torno de".
- **Nenhum número que não esteja nos manuais.** Há teste automático que extrai todo percentual
  e todo valor em reais do `conhecimento.ts` e confere contra os quatro manuais.
- **Contradição entre documentos:** vale `tabela_taxas_rex.pdf` e `tabela-adesao-rex.pdf`.
  Ou seja: TapTon débito Visa/Master 1 dia útil = **0,57%** (não 0,79%); adesão T2 Ton Mega+ =
  **R$49,88** (não R$59,88). Os valores perdedores são proibidos por teste.
- **Nunca falar da comissão do parceiro** (nem TapTon, nem Renda Ton, nem "Indique um
  Parceiro"). É informação interna.
- **Nunca inventar urgência.** Só existe prazo se o material trouxer prazo datado. Cupom
  vigente não "acaba amanhã".
- **Sem dependência nova no `package.json`.** OpenAI é `fetch`.
- **Commits frequentes**, um por tarefa no mínimo, sempre em português.

**Variáveis de ambiente (revisadas)** — no `.env` local e no EasyPanel:

```
TON_REFERRER=CEA4255F-0783-4EAD-AA55-48C682BA8FA7
OPENAI_MODEL=gpt-5.4-mini
AGENTE_ATIVO=true
AGENTE_DEBOUNCE_MS=8000
```

`TON_LINK_INDICACAO` **sai** (substituída pelo template + mapa de produtos).
`FOLLOWUP_HORAS` **sai** (substituída pela tabela de cadência).

---

## Pré-requisitos (do plano original, não repetidos aqui)

| Task original | Estado | Observação |
|---|---|---|
| 1 — migração `20260808_agente.sql` | **feita** | complementada pela Task 1 deste plano |
| 2 — `estagios.ts` | **feita** | `ESTAGIOS`, `ehEstagio`, `camposDeTransicao` |
| 3 — `admin-fake.ts` + `leads.server.ts` | **feita** | `obterLead`, `atualizarLead`, `moverEstagio`, `marcarPrecisaAtencao`, `registrarNota` |
| 4 — `conversas.server.ts` | **não existe** | substituída pela Task 5 deste plano |
| 5 — `mensagens.server.ts` | **feita** | `listarMensagens`, `enviarTextoDoCrm(admin, params, deps)` |
| 6 — `tarefas.server.ts` | **feita** | — |
| 7 — webhook agenda a resposta | **pendente** | fazer como está no plano original |
| 8 — spike da OpenAI | **pendente, obrigatório** | o formato de tool calling se descobre chamando a API |
| 9 — `openai.server.ts` | **pendente** | implementar contra o que a Task 8 capturou |

> **A Task 8 continua sendo pré-requisito das Tasks 8, 9 e 11 deste plano.** Se o spike mostrar
> que o endpoint é `/v1/responses`, o formato de `DEFINICOES_TOOLS` muda (tools achatadas, sem
> o envelope `function`) e o golden set muda junto. Ajuste ao formato real capturado — não ao
> que este plano supõe.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `supabase/migrations/20260808b_agente_regua.sql` | `leads.nao_perturbe`, `conversas.followup_toque`, `conversas.ciclo_pausado_ate` | 1 |
| `src/lib/agente/links.ts` | Template de URL + mapa de produtos. **Puro** | 2 |
| `src/lib/agente/conhecimento.ts` | Os quatro manuais destilados em blocos de prompt. **Puro** | 3 |
| `src/lib/crm/regua.ts` | Cadência 4 toques + pausa de 30 dias. **Puro** | 4 |
| `src/lib/crm/conversas.server.ts` | Agendamento, lock, pausa, toques e ciclo | 5 |
| `src/lib/crm/nao-perturbe.server.ts` | Opt-out permanente | 5 |
| `src/lib/agente/politica.ts` | Decide se o turno acontece e em que modo. **Puro** | 6 |
| `src/lib/agente/prompt.ts` | Monta o system prompt por modo e a instrução do toque. **Puro** | 7 |
| `src/lib/agente/tools.ts` | 4 tools: lead, link por produto, resultado da compra, escalar | 8 |
| `src/lib/agente/agente.server.ts` | O turno completo (venda, toque e pós-venda) | 9 |
| `src/lib/worker/selecao.ts` + `loop.server.ts` | Loop, lock, órfãos, backoff | 10 |
| `src/lib/agente/casos-golden.ts` + `golden.test.ts` | Golden set ampliado | 11 |
| `docs/superpowers/plans/2026-08-08-fatia-2-validacao.md` | Registro do teste em produção | 12 |

---

## Task 1: Migração complementar da régua

**Arquivos:**
- Criar: `supabase/migrations/20260808b_agente_regua.sql`

**Interfaces:**
- Consome: `20260808_agente.sql` (já aplicada)
- Produz: `leads.nao_perturbe`, `conversas.followup_toque`, `conversas.ciclo_pausado_ate`

- [ ] **Passo 1: Escrever a migração**

`supabase/migrations/20260808b_agente_regua.sql`:

```sql
-- Fatia 2 (revisão comercial): régua de 4 toques e opt-out permanente.
-- Complementa 20260808_agente.sql, que continua valendo.
--
-- A coluna conversas.followup_enviado vira redundante (a régua tem 4 toques,
-- não 1), mas FICA: renomear quebraria código já escrito e testado. Ela passa a
-- significar "algum toque já saiu neste ciclo".

-- ===================== LEADS: opt-out permanente =====================
-- O lead pediu para parar. Nenhum follow-up dispara nunca mais, em nenhum
-- estágio, e a conversa vai para o Pedro. É definitivo.
alter table public.leads
  add column nao_perturbe boolean not null default false;

-- ===================== CONVERSAS: régua de remarketing =====================
-- followup_toque = quantos toques do ciclo atual já saíram (0 a 4).
-- ciclo_pausado_ate = fim da pausa obrigatória de 30 dias depois do 4º toque
-- sem resposta. Enquanto estiver no futuro, nenhum toque dispara.
alter table public.conversas
  add column followup_toque smallint not null default 0
    check (followup_toque between 0 and 4),
  add column ciclo_pausado_ate timestamptz;

-- O worker já varre por responder_em (índice parcial criado em
-- 20260808_agente.sql). ciclo_pausado_ate não precisa de índice: só é lido
-- depois que a conversa já foi selecionada por responder_em.
```

- [ ] **Passo 2: Aplicar no Supabase**

Aplique via MCP do Supabase (`apply_migration`, projeto `fqnvwrhetpnwsxqfwxnf`, nome
`20260808b_agente_regua`) ou colando no SQL Editor.

- [ ] **Passo 3: Verificar que aplicou**

```sql
select column_name, data_type, column_default
  from information_schema.columns
 where (table_name = 'leads' and column_name = 'nao_perturbe')
    or (table_name = 'conversas' and column_name in ('followup_toque','ciclo_pausado_ate'));
```

Esperado: 3 linhas — `nao_perturbe` boolean default false, `followup_toque` smallint default
0, `ciclo_pausado_ate` timestamp with time zone sem default.

- [ ] **Passo 4: Provar o check de 0..4**

```sql
-- tem que FALHAR com violação de check
update public.conversas set followup_toque = 5
 where id = (select id from public.conversas limit 1);
```

Esperado: `new row for relation "conversas" violates check constraint`. Se passar, o check não
foi criado — refaça.

- [ ] **Passo 5: Regenerar os tipos**

```bash
npx supabase gen types typescript --project-id fqnvwrhetpnwsxqfwxnf > src/integrations/supabase/types.ts
```

Se o comando não estiver disponível, use o MCP `generate_typescript_types` e grave a saída no
mesmo arquivo.

- [ ] **Passo 6: Commit**

```bash
git add supabase/migrations/20260808b_agente_regua.sql src/integrations/supabase/types.ts
git commit -m "feat(db): regua de 4 toques e opt-out permanente"
```

---

## Task 2: `links.ts` — template de URL e mapa de produtos (puro)

**Arquivos:**
- Criar: `src/lib/agente/links.ts`
- Testar: `src/lib/agente/links.test.ts`

**Interfaces:**
- Consome: `TON_REFERRER` do ambiente
- Produz:
  - `type ProdutoId` — os 5 `productId` do adendo
  - `type AlvoDeLink = ProdutoId | "catalogo"`
  - `PRODUTOS: Record<ProdutoId, { userTag: string; nome: string | null; fonte: string }>`
  - `ALVOS_DE_LINK: readonly AlvoDeLink[]`
  - `ehAlvoDeLink(valor: unknown): valor is AlvoDeLink`
  - `montarLink(produto: unknown): { ok: true; url: string } | { ok: false; erro: "produto_desconhecido" | "referrer_ausente" }`

> **O nome comercial não se deduz do código do hardware.** Cada `productId` foi mapeado lendo
> `docs/conhecimento/produtos-e-taxas.md`: `S920` está listado no **nível T3** (seção 1.2),
> `D195` no **nível T2** (seção 1.3), e `SMART_POS` corresponde ao **nível T3 Smart** (seção
> 1.1). **`D150` não aparece em nenhum dos 10 documentos** — nome comercial `null`, e o agente
> nunca o oferece pelo nome.

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/links.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PRODUTOS, ALVOS_DE_LINK, ehAlvoDeLink, montarLink } from "./links.ts";

const REF = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";

function comReferrer<T>(fn: () => T): T {
  const original = process.env.TON_REFERRER;
  process.env.TON_REFERRER = REF;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.TON_REFERRER;
    else process.env.TON_REFERRER = original;
  }
}

test("conhece exatamente os cinco productId do adendo, mais o catálogo", () => {
  assert.deepEqual(ALVOS_DE_LINK.slice().sort(), [
    "TONBLACK_TIER_SMART_POS",
    "TONMEGA_TIER_D150",
    "TONMEGA_TIER_D195",
    "TONMEGA_TIER_S920",
    "TONMEGA_TIER_SMART_POS",
    "catalogo",
  ]);
});

test("cada produto carrega o userTag do plano", () => {
  assert.equal(PRODUTOS.TONBLACK_TIER_SMART_POS.userTag, "tonblack_tier");
  for (const id of ["TONMEGA_TIER_SMART_POS", "TONMEGA_TIER_S920", "TONMEGA_TIER_D195", "TONMEGA_TIER_D150"] as const) {
    assert.equal(PRODUTOS[id].userTag, "tonmega_tier", `${id} tem que ser tonmega_tier`);
  }
});

test("o nome comercial vem do manual, não do código do hardware", () => {
  // S920 está no nível T3 e D195 no nível T2 em produtos-e-taxas.md.
  assert.match(PRODUTOS.TONMEGA_TIER_S920.nome ?? "", /T3/);
  assert.doesNotMatch(PRODUTOS.TONMEGA_TIER_S920.nome ?? "", /T2|T3 Smart/);
  assert.match(PRODUTOS.TONMEGA_TIER_D195.nome ?? "", /T2/);
  assert.match(PRODUTOS.TONMEGA_TIER_SMART_POS.nome ?? "", /T3 Smart/);
  assert.match(PRODUTOS.TONBLACK_TIER_SMART_POS.nome ?? "", /T3 Smart/);
  assert.match(PRODUTOS.TONBLACK_TIER_SMART_POS.nome ?? "", /Black/);
});

test("D150 não tem nome comercial: não consta em nenhum manual", () => {
  // Inventar "T1" ou "T2" aqui seria exatamente o erro que o adendo proíbe.
  assert.equal(PRODUTOS.TONMEGA_TIER_D150.nome, null);
});

test("checkout leva productId, referrer e userTag no formato do adendo", () => {
  const r = comReferrer(() => montarLink("TONMEGA_TIER_S920"));
  assert.equal(r.ok, true);
  const url = (r as { ok: true; url: string }).url;
  assert.equal(
    url,
    "https://ton.com.br/checkout/cart/?productId=TONMEGA_TIER_S920" +
      `&referrer=${REF}&userAnticipation=0&userTag=tonmega_tier` +
      "&utm_medium=invite_share&utm_source=revendedor",
  );
});

test("checkout do Black usa o userTag do Black", () => {
  const r = comReferrer(() => montarLink("TONBLACK_TIER_SMART_POS"));
  assert.match((r as any).url, /userTag=tonblack_tier/);
  assert.match((r as any).url, /productId=TONBLACK_TIER_SMART_POS/);
});

test("catálogo tem formato próprio: sem productId e sem userTag", () => {
  const r = comReferrer(() => montarLink("catalogo"));
  assert.equal(r.ok, true);
  const url = (r as { ok: true; url: string }).url;
  assert.equal(
    url,
    `https://ton.com.br/catalogo/?referrer=${REF}&userAnticipation=0` +
      "&utm_medium=invite_share&utm_source=revendedor",
  );
  assert.equal(url.includes("productId"), false);
  assert.equal(url.includes("userTag"), false);
});

test("todo link carrega o referrer do Pedro", () => {
  for (const alvo of ALVOS_DE_LINK) {
    const r = comReferrer(() => montarLink(alvo));
    assert.match((r as any).url, new RegExp(`referrer=${REF}`), `${alvo} sem referrer`);
  }
});

test("produto inválido não vira link", () => {
  const r = comReferrer(() => montarLink("TONMEGA_TIER_INVENTADO"));
  assert.deepEqual(r, { ok: false, erro: "produto_desconhecido" });
  assert.deepEqual(comReferrer(() => montarLink(undefined)), { ok: false, erro: "produto_desconhecido" });
});

test("sem TON_REFERRER não monta link quebrado", () => {
  const original = process.env.TON_REFERRER;
  delete process.env.TON_REFERRER;
  try {
    assert.deepEqual(montarLink("catalogo"), { ok: false, erro: "referrer_ausente" });
  } finally {
    if (original !== undefined) process.env.TON_REFERRER = original;
  }
});

test("referrer só com espaço conta como ausente", () => {
  const original = process.env.TON_REFERRER;
  process.env.TON_REFERRER = "   ";
  try {
    assert.deepEqual(montarLink("catalogo"), { ok: false, erro: "referrer_ausente" });
  } finally {
    if (original === undefined) delete process.env.TON_REFERRER;
    else process.env.TON_REFERRER = original;
  }
});

test("ehAlvoDeLink aceita válido e rejeita inventado", () => {
  assert.equal(ehAlvoDeLink("catalogo"), true);
  assert.equal(ehAlvoDeLink("TONMEGA_TIER_D150"), true);
  assert.equal(ehAlvoDeLink("T3"), false);
  assert.equal(ehAlvoDeLink(null), false);
});

test("ehAlvoDeLink rejeita nome comercial (o modelo escolhe productId, não modelo)", () => {
  assert.equal(ehAlvoDeLink("T3 Smart"), false);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/links.test.ts
```

Esperado: FALHA com "Cannot find module './links.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/agente/links.ts`:

```ts
// Template de link de indicação + mapa de produtos.
//
// O modelo NUNCA escreve URL: ele escolhe qual produto, e este módulo monta o
// endereço. Assim não há como colar link errado, truncado ou de outro parceiro.
//
// Só o referrer é segredo de ambiente (TON_REFERRER). O mapa de produtos é
// tabela em código de propósito: são identificadores públicos de produto, e
// versioná-los deixa o mapa revisável em code review.
//
// O nome comercial de cada productId saiu de docs/conhecimento/produtos-e-taxas.md
// (extraído de guia_maquinas.pdf + tabela-adesao-rex.pdf). NÃO se deduz pelo
// código do hardware — foi lido no manual, seção por seção.

export const PRODUTOS = {
  // Seção 1.1 — nível T3 Smart (POS Android). Ton Black é exclusivo do Renda
  // Ton, só CNPJ e só T3/T3 Smart.
  TONBLACK_TIER_SMART_POS: {
    userTag: "tonblack_tier",
    nome: "T3 Smart no plano Ton Black",
    fonte: "produtos-e-taxas.md §1.1 e §6 (elegibilidade do Ton Black)",
  },
  TONMEGA_TIER_SMART_POS: {
    userTag: "tonmega_tier",
    nome: "T3 Smart no plano Ton Mega+",
    fonte: "produtos-e-taxas.md §1.1",
  },
  // Seção 1.2 — o S920 está listado no nível T3, não no T3 Smart.
  TONMEGA_TIER_S920: {
    userTag: "tonmega_tier",
    nome: "T3 no plano Ton Mega+ (modelo S920)",
    fonte: "produtos-e-taxas.md §1.2",
  },
  // Seção 1.3 — o D195 está listado no nível T2.
  TONMEGA_TIER_D195: {
    userTag: "tonmega_tier",
    nome: "T2 no plano Ton Mega+ (modelo D195)",
    fonte: "produtos-e-taxas.md §1.3",
  },
  // D150 NÃO aparece em nenhum dos 10 documentos lidos. O link funciona (é o
  // que o adendo manda), mas o agente não pode chamá-lo de T1/T2/T3: nome null
  // significa "não ofereça pelo nome", e o prompt não o lista.
  TONMEGA_TIER_D150: {
    userTag: "tonmega_tier",
    nome: null,
    fonte: "NÃO CONSTA NO MATERIAL",
  },
} as const;

export type ProdutoId = keyof typeof PRODUTOS;
export type AlvoDeLink = ProdutoId | "catalogo";

export const ALVOS_DE_LINK: readonly AlvoDeLink[] = [
  ...(Object.keys(PRODUTOS) as ProdutoId[]),
  "catalogo",
];

export function ehAlvoDeLink(valor: unknown): valor is AlvoDeLink {
  return typeof valor === "string" && (ALVOS_DE_LINK as readonly string[]).includes(valor);
}

const UTM = "utm_medium=invite_share&utm_source=revendedor";

export type ResultadoLink =
  | { ok: true; url: string }
  | { ok: false; erro: "produto_desconhecido" | "referrer_ausente" };

/**
 * Monta o link do alvo pedido.
 *
 * - `"catalogo"` quando o cliente ainda não decidiu: ele navega e escolhe.
 * - um `productId` quando já decidiu: cai direto no carrinho, que é o que
 *   converte melhor.
 *
 * Nunca lança: quem chama é a tool, e uma exceção aqui mataria o turno.
 */
export function montarLink(produto: unknown): ResultadoLink {
  if (!ehAlvoDeLink(produto)) return { ok: false, erro: "produto_desconhecido" };

  const referrer = process.env.TON_REFERRER?.trim();
  // Sem referrer o link até funciona, mas a indicação não é atribuída ao Pedro
  // — ou seja, a venda acontece e ele não ganha. Melhor não mandar nada.
  if (!referrer) return { ok: false, erro: "referrer_ausente" };

  if (produto === "catalogo") {
    return {
      ok: true,
      url: `https://ton.com.br/catalogo/?referrer=${referrer}&userAnticipation=0&${UTM}`,
    };
  }

  const { userTag } = PRODUTOS[produto];
  return {
    ok: true,
    url:
      `https://ton.com.br/checkout/cart/?productId=${produto}` +
      `&referrer=${referrer}&userAnticipation=0&userTag=${userTag}&${UTM}`,
  };
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/links.test.ts
```

Esperado: PASSA, 13 testes.

- [ ] **Passo 5: Conferir um link no navegador**

Abra o link do catálogo e o de um produto (ex.: `TONMEGA_TIER_SMART_POS`) num navegador
anônimo. Confirme que a página abre, que o produto certo aparece no carrinho e que a URL não
é rejeitada. **Se algum parâmetro for recusado, o mapa está errado — corrija antes de seguir.**

```bash
node --experimental-strip-types -e '
process.env.TON_REFERRER = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";
const { montarLink, ALVOS_DE_LINK } = await import("./src/lib/agente/links.ts");
for (const a of ALVOS_DE_LINK) console.log(a, "->", montarLink(a).url);
'
```

- [ ] **Passo 6: Commit**

```bash
git add src/lib/agente/links.ts src/lib/agente/links.test.ts
git commit -m "feat(agente): template de link e mapa de produtos por maquina"
```

---

## Task 3: `conhecimento.ts` — os quatro manuais destilados (puro)

**Arquivos:**
- Criar: `src/lib/agente/conhecimento.ts`
- Testar: `src/lib/agente/conhecimento.test.ts`

**Interfaces:**
- Consome: nada (puro; os manuais são lidos **por você**, na hora de escrever, e destilados em
  string — o módulo não lê arquivo em runtime)
- Produz:
  - `PERSONA_E_TOM`, `PRODUTOS_E_PRECOS`, `TAXAS`, `RECOMENDACAO`, `OBJECOES`, `POS_VENDA`,
    `REGRAS_ESCALACAO`: `string`
  - `CANAL_OFICIAL_TON: string`
  - `ANGULO_DO_TOQUE: Record<1 | 2 | 3 | 4, string>`
  - `CONHECIMENTO_VENDA: string` — persona + produtos + taxas + recomendação + objeções
  - `CONHECIMENTO_POS_VENDA: string` — persona + pós-venda

> **Recorte.** Os manuais somam ~1.600 linhas; o system prompt não comporta isso. O que entra é
> o que faz vender e o que impede erro caro: preço de adesão por nível, as **linhas-âncora** de
> cada tabela de taxa (promocional, faixa inicial e faixa final), as regras de navegação de
> faixa, as 9 objeções com o argumento central, as regras de recomendação por perfil e o
> pós-venda operacional. Fica de fora: ficha técnica dos 24 modelos, as tabelas completas de 2x
> a 21x por faixa e bandeira, o comparativo nominal com concorrentes, e tudo que é do parceiro
> (comissão, Ton na Mão, logística de pronta entrega, Indique um Parceiro).
> **A regra que fecha o buraco:** faixa ou parcela que não estiver aqui, o agente escala.

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/conhecimento.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONHECIMENTO_VENDA,
  CONHECIMENTO_POS_VENDA,
  POS_VENDA,
  REGRAS_ESCALACAO,
  CANAL_OFICIAL_TON,
  ANGULO_DO_TOQUE,
} from "./conhecimento.ts";

const RAIZ = new URL("../../../", import.meta.url);
const MANUAIS = [
  "produtos-e-taxas.md",
  "vendas-e-objecoes.md",
  "pos-venda-e-suporte.md",
  "gerador-de-mensagens.md",
];

/** Tira espaço e negrito para comparar "R$ 82,05" com "**R$82,05**". */
function normalizar(texto: string): string {
  return texto.replace(/\s+/g, "").replace(/\*/g, "");
}

async function textoDosManuais(): Promise<string> {
  const partes = await Promise.all(
    MANUAIS.map((nome) => readFile(new URL(`docs/conhecimento/${nome}`, RAIZ), "utf8")),
  );
  return normalizar(partes.join("\n"));
}

const TUDO = [CONHECIMENTO_VENDA, CONHECIMENTO_POS_VENDA].join("\n");

test("todo percentual do conhecimento existe nos manuais", async () => {
  const manuais = await textoDosManuais();
  const percentuais = TUDO.match(/\d+[.,]\d+\s*%/g) ?? [];
  assert.ok(percentuais.length > 20, "o conhecimento tem que trazer números de taxa");
  for (const bruto of new Set(percentuais)) {
    assert.ok(
      manuais.includes(normalizar(bruto)),
      `o percentual ${bruto} NÃO está em nenhum manual — o agente não pode falar isso`,
    );
  }
});

test("todo valor em reais do conhecimento existe nos manuais", async () => {
  const manuais = await textoDosManuais();
  const valores = TUDO.match(/R\$\s?\d[\d.]*(?:,\d{2})?/g) ?? [];
  assert.ok(valores.length > 10, "o conhecimento tem que trazer preço de adesão");
  for (const bruto of new Set(valores)) {
    assert.ok(
      manuais.includes(normalizar(bruto)),
      `o valor ${bruto} NÃO está em nenhum manual — o agente não pode falar isso`,
    );
  }
});

test("nas contradições vale a tabela oficial, e a perdedora não aparece", () => {
  // tabela_taxas_rex.pdf: TapTon débito Visa/Master 1 dia útil = 0,57%.
  assert.ok(TUDO.includes("0,57%"));
  assert.equal(TUDO.includes("0,79%"), false, "0,79% perdeu para 0,57%");
  // tabela-adesao-rex.pdf: T2 Ton Mega+ = R$49,88.
  assert.ok(TUDO.includes("R$49,88"));
  assert.equal(TUDO.includes("59,88"), false, "R$59,88 perdeu para R$49,88");
});

test("a comissão do parceiro nunca entra no conhecimento", () => {
  assert.equal(TUDO.includes("0,20%"), false);
  assert.doesNotMatch(TUDO, /comiss(ão|ao) (do|de) (parceiro|indica)/i);
  assert.doesNotMatch(TUDO, /Indique um Parceiro/i);
  // A REGRA de não falar comissão, essa sim, precisa existir.
  assert.match(REGRAS_ESCALACAO.toLowerCase(), /comiss/);
});

test("nenhuma URL de venda entra no prompt — o link só vem da tool", () => {
  assert.equal(TUDO.includes("ton.com.br/checkout"), false);
  assert.equal(TUDO.includes("ton.com.br/catalogo"), false);
  assert.equal(TUDO.includes("referrer"), false);
});

test("o pós-venda manda tentar resolver ANTES de encaminhar", () => {
  const p = POS_VENDA.toLowerCase();
  assert.match(p, /tente resolver/);
  assert.match(p, /confirme se resolveu/);
  assert.ok(POS_VENDA.includes(CANAL_OFICIAL_TON), "o canal oficial anda junto da escalação");
});

test("o canal oficial é o do dono, não um genérico", () => {
  assert.match(CANAL_OFICIAL_TON, /app da Ton/i);
  assert.match(CANAL_OFICIAL_TON, /https:\/\/ajuda\.ton\.com\.br\//);
});

test("as regras cobrem taxa fora da tabela e urgência inventada", () => {
  const r = REGRAS_ESCALACAO.toLowerCase();
  assert.match(r, /escalar_para_humano/);
  assert.match(r, /taxa/);
  assert.match(r, /urgência/);
});

test("os 4 ângulos da régua existem e são todos diferentes", () => {
  const angulos = [1, 2, 3, 4].map((n) => ANGULO_DO_TOQUE[n as 1 | 2 | 3 | 4]);
  assert.equal(new Set(angulos).size, 4, "repetir argumento é o que o material proíbe");
  for (const a of angulos) assert.ok(a.length > 30);
});

test("o D150 não é oferecido pelo nome (não consta no material)", () => {
  assert.equal(TUDO.includes("D150"), false);
});

test("a persona vale nos dois modos: nunca se apresenta como a Ton", () => {
  for (const bloco of [CONHECIMENTO_VENDA, CONHECIMENTO_POS_VENDA]) {
    assert.match(bloco, /Pedro/);
    assert.match(bloco, /NUNCA diga que é funcionário da Ton/);
  }
});

test("o conhecimento cabe no orçamento de prompt", () => {
  // ~22 mil caracteres ≈ 6 mil tokens: sobra espaço para 30 mensagens de
  // histórico sem estourar contexto nem custo por turno.
  assert.ok(CONHECIMENTO_VENDA.length < 22_000, `venda tem ${CONHECIMENTO_VENDA.length} chars`);
  assert.ok(
    CONHECIMENTO_POS_VENDA.length < 22_000,
    `pós-venda tem ${CONHECIMENTO_POS_VENDA.length} chars`,
  );
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/agente/conhecimento.test.ts
```

Esperado: FALHA com "Cannot find module './conhecimento.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/agente/conhecimento.ts`:

```ts
// Conhecimento do agente, destilado dos quatro manuais em docs/conhecimento/.
// Puro: só string.
//
// REGRA DURA: nenhum número entra aqui que não esteja nos manuais. Há teste que
// extrai todo percentual e todo valor em reais deste arquivo e confere contra os
// quatro documentos. Se você precisar de um número que não está lá, a resposta
// certa é escalar, não inventar.
//
// Nas duas contradições conhecidas vale a tabela oficial:
//   - TapTon débito Visa/Master 1 dia útil: 0,57% (tabela_taxas_rex.pdf), não
//     0,79% (faq-indique-tapton-taptopay.pdf);
//   - adesão T2 Ton Mega+: R$49,88 (tabela-adesao-rex.pdf), não R$59,88
//     (ton_x_concorrentes_rex.pdf).
//
// Na Fatia 3 este conteúdo vira seed do RAG e passa a ser editável pelo Pedro
// sem mudança de código.

/** Canal oficial informado pelo dono. Anda SEMPRE junto de qualquer escalação. */
export const CANAL_OFICIAL_TON = "o app da Ton ou https://ajuda.ton.com.br/";

export const PERSONA_E_TOM = `
## Quem você é

Você é o assistente do Pedro, consultor parceiro da Ton (Stone Co.) no programa Renda Ton.
Você fala EM NOME do Pedro, na primeira pessoa. NUNCA diga que é funcionário da Ton nem que
representa a Ton: é regra do programa. Se perguntarem, você é o consultor parceiro.

## Como você fala

- Mensagem curta, uma ideia por vez, do tamanho de uma tela de WhatsApp. Se a mensagem rola na
  tela, foi longe demais.
- Trate por você. Emoji com parcimônia. Termine sempre com uma pergunta fácil de responder.
- Diagnostique antes de oferecer: pergunte qual maquininha ele usa hoje e quanto paga de taxa
  antes de recomendar qualquer coisa.
- Objeção é pedido de informação, não rejeição: ouça, valide e responda com fato, sem discutir.
- Seja conselheiro, não empurrador. Às vezes a recomendação certa é a máquina mais simples.
- Nunca abra com "oi, sou parceiro Ton". Abra pela dor ou por um número: "tá pagando quanto de
  taxa na maquininha hoje?".
- Prove em vez de prometer: proponha mostrar a conta lado a lado, não adjetivo.
- Nunca fale mal de concorrente. Compare pelo ganho do cliente.
`.trim();

export const PRODUTOS_E_PRECOS = `
## Os dois planos

- **Ton Mega+**: aceita CPF ou CNPJ, vale para todas as máquinas (T1, T2, T3 e T3 Smart) e está
  disponível no site. É a oferta padrão.
- **Ton Black**: exclusivo do programa Renda Ton, **somente CNPJ**, **somente T3 ou T3 Smart**,
  e não aparece no site — só pelo link do parceiro. Taxa menor, para quem já vende muito. O Ton
  Black **não permite migração** depois de aderido. Se um cliente CPF tentar, o checkout trava
  ao pedir o CNPJ.
- Migrar para o Ton Mega+ custa R$178,00 — ou o cliente adere uma nova maquininha já no plano
  desejado, sem essa taxa.

## Preço de adesão (é por nível de oferta, não por modelo)

Não há mensalidade e não há aluguel em nenhum plano. A adesão é uma vez só e parcela em até 12x
no site.

| Nível | Ton Mega+ | Ton Black |
|---|---|---|
| T1 (entrada) | R$16,80 ou 12x de R$1,40 | não existe no Black |
| T2 | R$49,88 ou 12x de R$4,16 | não existe no Black |
| T3 | R$108,00 ou 12x de R$9,00 | R$129,00 ou 12x de R$10,75 |
| T3 Smart (topo) | R$191,88 ou 12x de R$15,99 | R$189,00 ou 12x de R$15,75 |

Cupom de desconto na adesão: 5%, 10%, 15% ou 20%, conforme o que o Pedro tiver disponível.
**O cupom não se aplica ao T1.** Nunca diga que um cupom está acabando se ele segue vigente.

## O que cada nível entrega

- **T1**: modelo de entrada. Não faz Pix por QR Code na maquininha e não aceita cupom.
- **T2**: já faz Pix por QR Code na maquininha (exige Super Conta Ton aprovada).
- **T3**: Pix por QR Code, e é a partir do T3 que existe parcelamento em 21x para o cliente
  final.
- **T3 Smart**: o topo — tela grande, App Catálogo e Modo Fichas (imprime ficha, ideal para
  evento e fila), parcelamento em 21x, garantia vitalícia.
- **TapTon**: o celular do cliente vira maquininha, por aproximação. Sem taxa de adesão e sem
  mensalidade para usar. Precisa de Android 10.0+ com NFC, ou iPhone XS+ com iOS 17+.

## Outros diferenciais que valem citar

- Sem mensalidade e sem aluguel, em todos os planos.
- Garantia vitalícia no T3 Smart.
- 56 bandeiras aceitas na maquininha física: 40 de crédito/débito e 16 exclusivas de voucher
  (vale-alimentação/refeição, para CNPJ do ramo de alimentação).
- Visa, Mastercard, Elo e Amex já vêm habilitadas de fábrica, com a taxa da tabela. As outras o
  cliente solicita direto à bandeira (costuma sair em até 48h); só a Banricompras passa também
  pelo atendimento do Ton.
- Atenção: **as bandeiras extras só valem na maquininha física.** TapTon e link de pagamento
  seguem só com Visa, Mastercard, Elo e Amex.
- Conta Ton com Pix, link de pagamento, pagamento de contas e Baú do Ton (o dinheiro rende).
- Área MEI dentro do app: emite e paga o DAS, avisa vencimento e envia a declaração de
  faturamento.
- Suporte 24h por dia. Nota 9,2 no Reclame Aqui.
`.trim();

export const TAXAS = `
## Taxas — responda com estes números, e só com eles

Você PODE falar de taxa. O número vem desta tabela, que saiu do documento oficial. Nunca
arredonde, nunca estime, nunca diga "gira em torno de". Se a faixa, a parcela, a bandeira ou o
canal que o cliente pediu não estiver escrito aqui, **escale** — não interpole.

Toda taxa abaixo é do recebimento em **1 dia útil**, salvo onde diz "Na Hora". "Na Hora" é
recebimento imediato e custa mais.

### Ton Mega+ na maquininha — Visa e Mastercard

| Modalidade | Promocional | Até R$3 mil | Acima de R$30 mil |
|---|---|---|---|
| Débito | 0,57% | 1,69% | 1,19% |
| Crédito à vista | 0,57% | 3,86% | 2,85% |
| Crédito 2x | 3,97% | — | — |
| Crédito 12x | 7,97% | 20,39% | 11,51% |
| Crédito 18x | 14,87% | — | — |
| Pix QR Code | 0% | 0% | 0% |

### Ton Mega+ na maquininha — Elo e American Express (mais caro)

| Modalidade | Promocional | Até R$3 mil |
|---|---|---|
| Débito | 2,57% | 2,98% |
| Crédito à vista | 4,34% | 5,15% |

### Ton Black na maquininha (só CNPJ, só T3 e T3 Smart) — Visa e Mastercard

| Modalidade | Até R$20 mil | Acima de R$80 mil | Na Hora (todas as faixas) |
|---|---|---|---|
| Débito | 1,36% | 0,74% | 2,28% |
| Crédito à vista | 3,14% | 2,68% | 5,48% |
| Crédito 12x | 12,39% | 8,98% | 18,28% |
| Pix QR Code | 0% | 0% | 0% |

### TapTon (celular como maquininha) — plano Ton Mega+, Visa e Mastercard

| Modalidade | 1 dia útil | Na Hora |
|---|---|---|
| Débito | 0,57% | 0,87% |
| Crédito à vista | 3,05% | 3,08% |
| Crédito 12x | 12,29% | 12,35% |

### Link de pagamento — plano Ton Mega+

| Modalidade | 1 dia útil | 30 dias |
|---|---|---|
| Débito e crédito à vista | 4,19% | 3,19% |
| Crédito 12x | 16,65% | 15,99% |

### Pix — a regra completa

- **Ton Mega+**: 0% nos primeiros 30 dias depois da primeira venda por Pix. Depois disso,
  continua 0% por tempo indeterminado **se o cliente cadastrar chave Pix forte** (CPF, CNPJ ou
  telefone). Sem chave forte, passa a 0,49%. Se ele apagar a chave, volta a cobrar.
- **Ton Black**: 0% por tempo indeterminado, sem pré-requisito.

### Como o cliente anda de faixa

- **Ton Mega+**: entra na faixa promocional e fica nela por 30 dias ou até vender R$5 mil, o
  que vier primeiro. Depois, vai para a faixa correspondente ao volume que fez.
- **Ton Black**: começa nos primeiros 30 dias na faixa "até R$20 mil" e depois recalcula todo
  mês, com base no mês fechado anterior.
- Contam para o faturamento: vendas na maquininha, no TapTon, no Pix QR Code e no link de
  pagamento, do equipamento do plano contratado.

### O que NÃO está aqui (e portanto escala)

Faixas intermediárias, parcelas que não sejam à vista, 2x, 12x ou 18x, taxas de Elo/Amex fora
das duas linhas acima, taxas do TapTon para quem já é cliente da base, e qualquer negociação
especial por faturamento.
`.trim();

export const RECOMENDACAO = `
## Como qualificar (nesta ordem)

1. Conexão rápida, sem se apresentar como parceiro: elogie o negócio, comente o movimento.
2. Situação: "qual maquininha você usa hoje?".
3. Problema: "o que mais te incomoda nela?".
4. Implicação: "tá pagando quanto de taxa hoje?" / "quanto isso te custa por mês?".
5. Necessidade: "se desse pra resolver isso, ajudaria?".
6. CTA leve: "posso te mostrar em 1 minuto quanto dá pra economizar?".

Só recomende máquina depois de saber o ramo, o volume e como ele vende hoje.

## Qual máquina indicar

- **CNPJ que fatura alto (a partir de R$80 mil por mês)** → Ton Black com T3 Smart. É decisão
  financeira: quem vende muito paga menos taxa.
- **CPF, ou CNPJ que ainda não tem volume** → Ton Mega+. O nível sai do que ele precisa.
- **Quer receber por Pix QR Code na maquininha** → T2, T3 ou T3 Smart (o T1 não faz).
- **Vende na rua, na casa do cliente, ou não quer carregar máquina** → TapTon.
- **Evento, feira, barraca, food truck, bar com jogo — fila e pico de atendimento** → T3 Smart
  com App Catálogo e Modo Fichas: produto pré-cadastrado, toca e vende, imprime ficha, mata
  fila e erro de digitação.
- **Ticket alto, ou perde venda por não parcelar mais** → T3 ou T3 Smart, que fazem 21x.
- **MEI que precisa se organizar** → qualquer nível, destacando a Área MEI do app (DAS,
  vencimento, declaração de faturamento).
- Quando o cliente ainda não decidiu nada, mande o **catálogo** e deixe ele olhar. Quando ele
  já escolheu, mande o checkout do produto: cai direto no carrinho.
`.trim();

export const OBJECOES = `
## Quebra de objeções (use o argumento, não um script decorado)

**"Tá caro"** — a máquina é barata e parcela; começa em R$16,80 e não tem mensalidade. O que
pesa no bolso dele é a taxa. Pergunte qual máquina ele usa e qual taxa paga hoje, e compare com
número. Não baixe preço e não jogue taxa no ar antes de saber a dele.

**"Já tenho maquininha"** — ótimo, então ele sente na pele o que incomoda. "E quanto você paga
de taxa hoje?" Compare sem falar mal da concorrente: recebimento na hora, sem mensalidade,
manutenção por conta do Ton. Como não tem mensalidade, dá para testar sem largar a atual.

**"Vou pensar"** — descubra o que segura: é a taxa, o prazo de receber, ou outra coisa? Se
alguém decide junto, alinhe com essa pessoa também. Combine uma data concreta de retorno. Nunca
aceite o "vou pensar" sem data, e nunca invente validade de cupom para forçar.

**"Vou falar com meu sócio"** — pergunte qual é a dúvida do sócio (taxa, prazo ou confiança) e
entregue o argumento pronto para ele levar. Ofereça falar com os dois. Marque o retorno.

**"Só uso Pix"** — o Pix continua sendo dele, e recebendo o Pix pela maquininha a venda só
conclui quando o dinheiro cai na conta: acaba o comprovante falso. E o cliente que só tem cartão
deixa de ser venda perdida. Para quem vende pouco, não force parcelamento.

**"Não aceito muito cartão"** — sem mensalidade, a máquina parada não custa nada; quando aparece
o cliente que só tem cartão, a venda é dele. É venda nova, não custo novo.

**"Isso é golpe?"** — o Ton é da Stone, autorizada pelo Banco Central; a compra é no canal
oficial e você não pede nenhum dado dele. Convide a conferir Reclame Aqui e redes sociais. Quem
pergunta sobre fraude está quase comprando — não se ofenda, dê prova.

**"Tenho medo de não saber usar"** — é a parte fácil: liga, aproxima o cartão, pronto. Tem
suporte 24h e você acompanha a primeira venda. Não despeje recurso técnico, isso aumenta o medo.

**"Não gostei do comodato"** — o nome assusta, mas protege: sem mensalidade, sem meta de
faturamento e com manutenção por conta do Ton. Se a máquina fosse comprada e quebrasse, o
prejuízo seria dele.

**"Tem mensalidade ou aluguel?"** — nenhum. Nem no Mega+, nem no Black.

## Gancho por ramo (encaixe quando souber o ramo)

- Beleza: o combo de serviços sobe o valor do atendimento quando dá para parcelar.
- Alimentação e bar: recebe rápido, aceita Pix, cartão e vale-refeição na mesma máquina, sem
  perder venda na fila.
- Mercado: movimento alto — aceitar tudo numa máquina só agiliza o caixa.
- Moda: o cliente decide na hora, e parcelar é o que fecha a peça de maior valor.
- Estética: ticket alto, o parcelamento é o que viabiliza o procedimento.
- Serviços e autônomos: máquina leve que aceita tudo evita o "só Pix" que faz perder cliente.
- Construção: valor alto, parcelamento fecha a compra grande.
- Academia: mensalidade no cartão reduz inadimplência.
- Pet shop: o cliente volta sempre, aceitar cartão e Pix aumenta o ticket.

## Erros que queimam a venda

- Comparar taxa no escuro, sem saber a que ele paga hoje.
- Atacar a concorrente ou empurrar a troca na marra.
- Inventar prazo de urgência. Urgência falsa queima sua confiança.
- Repetir a mesma mensagem sem trazer nada novo.
- Falar de si em vez da dor do cliente.
`.trim();

export const POS_VENDA = `
## Depois que ele compra, você continua

Você acompanha o cliente até a máquina estar funcionando. Diante de qualquer problema, a ordem é
sempre esta, e nunca o contrário:

1. **Tente resolver** com o que está escrito aqui. Conduza passo a passo, uma etapa por
   mensagem.
2. **Confirme se resolveu.** Pergunte se funcionou. Não presuma.
3. **Só então encaminhe**, e apenas quando a tentativa não resolveu, quando o problema não está
   escrito aqui, ou quando este material manda encaminhar. Ao encaminhar, entregue o canal:
   ${CANAL_OFICIAL_TON}. Nunca diga só "procure o suporte da Ton".

Sumir quando a máquina do cliente dá problema é o erro mais grave do programa. Cliente
abandonado vira detrator; cliente conduzido vira indicação.

## Concluir o cadastro (o primeiro passo depois da compra)

1. Baixar o app do Ton e tocar em "Meu primeiro acesso", com o **mesmo e-mail usado na adesão**.
2. O app pede validação de dados e envio de documentos (KYC) — obrigatório para CPF e CNPJ.
3. Em "Ativar conta", informar os dados do titular. Quem preenche tem que ser a mesma pessoa do
   cadastro.
4. Enviar a selfie, em ambiente claro, sem óculos e sem boné.
5. Em CPF, confirmar o e-mail na caixa de entrada.
6. Em CNPJ, o app pergunta se ele é do quadro societário: "Sou dono" segue direto; "Não sou
   dono(a)" exige procuração.
7. Enviar os documentos (foto na hora ou PDF já existente) e aguardar a análise.

## Documentos aceitos

- **CPF**: RG (frente e verso; xerox só autenticada), CNH (frente e verso; digital só do app
  oficial do DETRAN), passaporte brasileiro, carteira de trabalho nova impressa (a digital não
  vale), identidade profissional que diga "válida como documento de identificação em todo o
  território nacional".
- **CNPJ**: MEI usa o CCMEI; LTDA usa contrato social registrado na Junta ou com chancela de
  cartório; EIRELI usa o ato constitutivo; EI-ME e EI-EPP usam o requerimento de empresário;
  associação, igreja e afins usam estatuto social e ata registrada.
- **Quem não é sócio** precisa de procuração pública ou particular com firma reconhecida (ou
  assinada por plataforma eletrônica), com poder para abrir, movimentar e encerrar conta, dados
  completos da empresa e de pelo menos um sócio. Reprova: procuração de banco específico, com
  validade curta, com limite de valor, ou conjunta.
- Dá para conferir o quadro societário e a situação do CNPJ no site da Receita, em "Consultar
  CNPJ" — qualquer situação diferente de "Ativo" impede a aprovação da conta.

## Cadastro pendente ou recusado

O que falta volta **dentro do próprio app**, e o cliente reenvia por lá. O que mais atrasa:
documento ilegível, incompleto, dentro de plástico, ou o documento errado para o tipo de
cadastro. Peça foto nítida, sem corte, do documento inteiro.

## Saldo bloqueado

É o "bloqueio preventivo": a Ton analisa transações periodicamente, conforme contrato, e pode
reter o saldo de forma temporária. **Não quer dizer que o cliente fez algo errado.**

- Se pedirem comprovação, ele tem até 48 horas para enviar.
- A análise costuma responder em até 72 horas.
- Quanto mais detalhe sobre a venda, mais rápida a análise. Os três pilares: prova da negociação
  (contrato, ordem de serviço, ficha), prova do pagamento (nota fiscal) e prova da entrega
  (comprovante, medição, termo de garantia). O comprovante impresso da maquininha **não**
  comprova a venda — só o pagamento.
- Passar o próprio cartão na máquina, sem venda real, pode dar bloqueio definitivo e
  encerramento da conta.

## Chave Pix

Peça para cadastrar a chave Pix principal no app logo depois de fechar. No dia seguinte,
pergunte se já cadastrou. Se em até 3 dias ainda não tiver feito, reforce: sem chave forte
cadastrada, o Pix do Ton Mega+ passa a 0,49% depois dos 30 dias.

## Bandeiras e vouchers

Visa, Mastercard, Elo e Amex já vêm habilitadas. Para as outras: Central de Ajuda do Ton →
procurar a bandeira → pedir credenciamento no site ou telefone da própria bandeira (a taxa é
negociada com ela) → aguardar, em geral até 48h → conferir no app da bandeira.

## Máquina entregue pelo parceiro (pronta entrega)

Cada máquina tem ordem de serviço própria, então pode não chegar junto. Se já foi entregue mas
não aparece no sistema, pode levar até 3 dias úteis. O cliente só ativa depois que o repasse foi
concluído no app pelo parceiro. Arrependimento: o repasse pode ser cancelado em até 15 dias.

## MEI

Ajudar a formalizar é apoio legítimo; empurrar a abertura de MEI só para fechar venda, não.

- MEI é CNPJ simplificado, com DAS mensal fixo (não é percentual sobre venda) e INSS incluso.
- Limite de faturamento: R$81 mil por ano (referência de R$6.750 por mês).
- DAS em 2026: R$82,05 no comércio ou indústria, R$86,05 em serviços, R$87,05 nos dois. É devido
  todo mês, mesmo sem faturar.
- **Não podem** abrir MEI: profissões de conselho de classe (advogado, médico, engenheiro,
  contador, dentista, psicólogo), servidor público federal em atividade, sócio ou administrador
  de outra empresa, e aposentado por invalidez.
- **Cuidado antes de indicar**: quem recebe Bolsa Família, BPC/LOAS, auxílio-doença,
  salário-maternidade ou seguro-desemprego pode perder o benefício. Pergunte isso ANTES.

## O que você não sabe e portanto encaminha

Prazo de aprovação do cadastro e prazo de entrega no fluxo padrão não estão no material — não
invente. Estorno, cancelamento de venda (que é irreversível), desbloqueio definitivo e qualquer
coisa fora do que está escrito acima: conduza para ${CANAL_OFICIAL_TON}.
`.trim();

export const REGRAS_ESCALACAO = `
## Quando você chama escalar_para_humano e para de responder

1. O cliente pede negociação especial de taxa, ou pergunta uma faixa, parcela, bandeira ou canal
   que NÃO está na tabela de taxas acima. Você não interpola número.
2. O cliente pede para falar com uma pessoa — inclusive de forma indireta ("é robô?", "me liga",
   "quero falar com alguém").
3. O cliente está irritado ou o assunto virou reclamação formal.
4. A pergunta é sobre prazo, regra ou política da Ton que não está escrita no seu conhecimento.
5. No pós-venda: só depois de tentar resolver e confirmar que não resolveu.

Ao escalar, avise de forma natural que vai confirmar e já retorna — e, se for assunto de suporte
da Ton, entregue o canal: ${CANAL_OFICIAL_TON}.

## O que você NUNCA faz

- Falar da comissão do Pedro, quanto ele ganha, ou como o programa remunera quem indica. É
  informação interna, em qualquer contexto.
- Dizer um número de taxa, preço ou prazo que não esteja escrito no seu conhecimento.
- Inventar urgência: prazo que não existe, cupom que "acaba hoje" quando segue vigente, estoque
  que não é seu.
- Prometer aprovação do cadastro, prazo de entrega ou valor de recebimento.
- Falar mal de concorrente.
- Escrever um link você mesmo. O link SÓ vem da tool registrar_link_enviado, que devolve a URL
  pronta — você escolhe o produto, nunca digita endereço.
- Insistir com quem pediu para parar. Se o cliente pedir para não receber mais mensagem, chame
  registrar_resultado_compra com resultado "nao_perturbe" imediatamente.
`.trim();

/**
 * O ângulo de cada toque da régua (cadência oficial: urgencia_remarketing.pdf).
 * Cada toque precisa de motivo NOVO — repetir o argumento anterior é o que o
 * material classifica como perseguição.
 */
export const ANGULO_DO_TOQUE: Record<1 | 2 | 3 | 4, string> = {
  1:
    "Pergunte se ele conseguiu concluir o cadastro e se travou em alguma parte. Ofereça ajuda " +
    "no passo em que ele parou. Não cobre e não repita o link.",
  2:
    "Descubra a objeção real: pergunte, de forma leve, o que pesou na hora de decidir — se foi " +
    "a taxa, o valor da máquina, o prazo, ou se apareceu outra prioridade.",
  3:
    "Quebre a objeção mais provável pelo que você já sabe deste lead, usando o material de " +
    "objeções. Traga um argumento que ainda não apareceu nesta conversa.",
  4:
    "Última mensagem do ciclo: traga uma prova concreta ou um benefício ainda não citado " +
    "(bandeiras, Área MEI, Pix 0%, garantia vitalícia). Só cite prazo se ele for real. Feche " +
    "dizendo que fica à disposição, sem cobrar resposta.",
};

export const CONHECIMENTO_VENDA = [
  PERSONA_E_TOM,
  PRODUTOS_E_PRECOS,
  TAXAS,
  RECOMENDACAO,
  OBJECOES,
].join("\n\n");

export const CONHECIMENTO_POS_VENDA = [PERSONA_E_TOM, POS_VENDA].join("\n\n");
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/conhecimento.test.ts
```

Esperado: PASSA, 12 testes. **Se o teste de percentual ou de valor em reais reclamar de algum
número, o número está errado — corrija pelo manual, nunca ajuste o teste.**

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/conhecimento.ts src/lib/agente/conhecimento.test.ts
git commit -m "feat(agente): conhecimento comercial destilado dos quatro manuais"
```

---

## Task 4: `regua.ts` — a cadência oficial de 4 toques (puro)

**Arquivos:**
- Criar: `src/lib/crm/regua.ts`
- Testar: `src/lib/crm/regua.test.ts`

**Interfaces:**
- Consome: nada (puro)
- Produz:
  - `DIAS_DO_TOQUE = [1, 2, 5, 10]` e `TOTAL_DE_TOQUES = 4`
  - `DIAS_DE_PAUSA = 30`, `MS_POR_DIA`
  - `type PlanoDoToque = { tipo: "toque"; toque: number; quandoIso: string } | { tipo: "pausa"; ateIso: string }`
  - `planejarProximoToque(toqueAtual: number, linkEnviadoEmMs: number, agoraMs: number): PlanoDoToque`
  - `cicloEstaPausado(cicloPausadoAte: string | null, agoraMs: number): boolean`

> **De onde vem [1, 2, 5, 10].** A tabela do adendo conta a partir do envio do link: toque 1 é
> "dia 0 + 24h", toque 2 é "+2 dias", toque 3 "+5 dias" e toque 4 "+10 dias". Todos os offsets
> são medidos do link, não do toque anterior — por isso a lista é absoluta. O espaçamento
> mínimo de 1 dia entre toques cai de graça dessa lista.

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/crm/regua.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_DO_TOQUE,
  TOTAL_DE_TOQUES,
  DIAS_DE_PAUSA,
  MS_POR_DIA,
  planejarProximoToque,
  cicloEstaPausado,
} from "./regua.ts";

const LINK = Date.parse("2026-08-08T12:00:00.000Z");

test("a cadência é a oficial: 4 toques em 1, 2, 5 e 10 dias do link", () => {
  assert.deepEqual([...DIAS_DO_TOQUE], [1, 2, 5, 10]);
  assert.equal(TOTAL_DE_TOQUES, 4);
  assert.equal(DIAS_DE_PAUSA, 30);
});

test("do zero, o primeiro toque cai 24h depois do link", () => {
  const plano = planejarProximoToque(0, LINK, LINK);
  assert.deepEqual(plano, {
    tipo: "toque",
    toque: 1,
    quandoIso: new Date(LINK + 1 * MS_POR_DIA).toISOString(),
  });
});

test("cada toque seguinte usa o offset absoluto do link", () => {
  assert.equal(
    (planejarProximoToque(1, LINK, LINK + MS_POR_DIA) as any).quandoIso,
    new Date(LINK + 2 * MS_POR_DIA).toISOString(),
  );
  assert.equal(
    (planejarProximoToque(2, LINK, LINK + 2 * MS_POR_DIA) as any).quandoIso,
    new Date(LINK + 5 * MS_POR_DIA).toISOString(),
  );
  assert.equal(
    (planejarProximoToque(3, LINK, LINK + 5 * MS_POR_DIA) as any).quandoIso,
    new Date(LINK + 10 * MS_POR_DIA).toISOString(),
  );
});

test("depois do 4º toque vem pausa obrigatória de 30 dias, não um 5º", () => {
  const agora = LINK + 10 * MS_POR_DIA;
  const plano = planejarProximoToque(4, LINK, agora);
  assert.deepEqual(plano, {
    tipo: "pausa",
    ateIso: new Date(agora + DIAS_DE_PAUSA * MS_POR_DIA).toISOString(),
  });
});

test("toque fora da faixa também vira pausa, nunca um toque extra", () => {
  // Defesa contra dado sujo no banco: o que não é 0..3 não gera toque.
  assert.equal(planejarProximoToque(9, LINK, LINK).tipo, "pausa");
  assert.equal(planejarProximoToque(-1, LINK, LINK).tipo, "pausa");
});

test("worker atrasado não agenda toque no passado", () => {
  // O container ficou fora do ar uma semana; o toque 1 já venceu há dias.
  const agora = LINK + 7 * MS_POR_DIA;
  const plano = planejarProximoToque(0, LINK, agora) as any;
  assert.equal(plano.toque, 1);
  assert.equal(plano.quandoIso, new Date(agora).toISOString(), "agenda para agora, não para o passado");
});

test("link com data ilegível não trava a régua", () => {
  const agora = Date.parse("2026-09-01T00:00:00.000Z");
  const plano = planejarProximoToque(0, Number.NaN, agora) as any;
  assert.equal(plano.tipo, "toque");
  assert.equal(plano.quandoIso, new Date(agora + MS_POR_DIA).toISOString());
});

test("cicloEstaPausado só é verdade enquanto a pausa não venceu", () => {
  const agora = Date.parse("2026-09-01T00:00:00.000Z");
  assert.equal(cicloEstaPausado(null, agora), false);
  assert.equal(cicloEstaPausado("2026-09-10T00:00:00.000Z", agora), true);
  assert.equal(cicloEstaPausado("2026-08-31T23:59:59.000Z", agora), false);
  // Data ilegível: não pausa. Prender o lead para sempre é pior do que um toque.
  assert.equal(cicloEstaPausado("não é data", agora), false);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/crm/regua.test.ts
```

Esperado: FALHA com "Cannot find module './regua.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/crm/regua.ts`:

```ts
// Puro: a cadência oficial de remarketing da Ton (urgencia_remarketing.pdf),
// adotada no adendo comercial de 2026-08-08.
//
// 4 toques por ciclo, contados A PARTIR DO ENVIO DO LINK, e depois pausa
// obrigatória de 30 dias. O material trata frequência sem cadência como
// "perseguição (contra diretrizes)" — passar de 4 toques não é agressividade
// comercial, é infração de programa.

export const MS_POR_DIA = 86_400_000;

/**
 * Dias, contados do envio do link, de cada toque:
 * toque 1 = dia 0 + 24h, toque 2 = +2 dias, toque 3 = +5, toque 4 = +10.
 */
export const DIAS_DO_TOQUE = [1, 2, 5, 10] as const;

export const TOTAL_DE_TOQUES = DIAS_DO_TOQUE.length;

/** Pausa obrigatória depois do 4º toque sem resposta. */
export const DIAS_DE_PAUSA = 30;

export type PlanoDoToque =
  | { tipo: "toque"; toque: number; quandoIso: string }
  | { tipo: "pausa"; ateIso: string };

/**
 * Decide o que acontece depois do toque `toqueAtual`.
 *
 * `toqueAtual` é quantos toques deste ciclo já saíram (0 = nenhum ainda).
 * Devolve o próximo toque com o instante em que ele deve sair, ou a pausa de
 * 30 dias quando o ciclo acabou.
 */
export function planejarProximoToque(
  toqueAtual: number,
  linkEnviadoEmMs: number,
  agoraMs: number,
): PlanoDoToque {
  const proximo = toqueAtual + 1;

  // Fora de 1..4 (inclusive lixo no banco): o ciclo acabou.
  if (!Number.isInteger(proximo) || proximo < 1 || proximo > TOTAL_DE_TOQUES) {
    return { tipo: "pausa", ateIso: new Date(agoraMs + DIAS_DE_PAUSA * MS_POR_DIA).toISOString() };
  }

  // Sem data de link legível, conta a partir de agora: um toque atrasado é
  // melhor que um lead que nunca mais recebe nada.
  const base = Number.isFinite(linkEnviadoEmMs) ? linkEnviadoEmMs : agoraMs;
  const alvo = base + DIAS_DO_TOQUE[proximo - 1] * MS_POR_DIA;

  // Worker que ficou fora do ar não dispara toque com data no passado — e não
  // dispara os atrasados em rajada, porque só um toque é planejado por vez.
  const quando = Math.max(alvo, agoraMs);

  return { tipo: "toque", toque: proximo, quandoIso: new Date(quando).toISOString() };
}

export function cicloEstaPausado(cicloPausadoAte: string | null, agoraMs: number): boolean {
  if (!cicloPausadoAte) return false;
  const ate = Date.parse(cicloPausadoAte);
  // Data ilegível: não pausa. Prender o lead para sempre é pior do que um toque.
  if (Number.isNaN(ate)) return false;
  return ate > agoraMs;
}
```

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/regua.test.ts
```

Esperado: PASSA, 8 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/crm/regua.ts src/lib/crm/regua.test.ts
git commit -m "feat(crm): cadencia oficial de 4 toques com pausa de 30 dias"
```

---

## Task 5: Conversas (agendamento, régua e ciclo) + opt-out permanente

**Arquivos:**
- Criar: `src/lib/crm/conversas.server.ts` (**substitui a Task 4 do plano original** — o arquivo
  nunca chegou a ser escrito; aqui ele nasce já com a régua)
- Criar: `src/lib/crm/nao-perturbe.server.ts`
- Testar: `src/lib/crm/conversas.server.test.ts`
- Testar: `src/lib/crm/nao-perturbe.server.test.ts`

**Interfaces:**
- Consome: `criarAdminFake` (`admin-fake.ts`), `MS_POR_DIA`/`DIAS_DE_PAUSA` (Task 4)
- Produz, em `conversas.server.ts`:
  - `MS_POR_TENTATIVA = 30_000`, `MAX_TENTATIVAS = 3`
  - `agendarResposta(admin, conversaId, atrasoMs)` / `agendarToque(admin, conversaId, quandoIso)`
  - `limparAgendamento(admin, conversaId)` / `soltarLock(admin, conversaId)`
  - `registrarFalha(admin, conversaId, tentativas, erro)`
  - `registrarToqueEnviado(admin, conversaId, toque)`
  - `pausarCiclo(admin, conversaId, ateIso)` / `reiniciarCiclo(admin, conversaId)`
  - `pausarIa(admin, conversaId)` / `retomarIa(admin, conversaId)`
  - `marcarLida(admin, leadId)` / `listarConversas(admin, limite?)`
- Produz, em `nao-perturbe.server.ts`:
  - `registrarNaoPerturbe(admin, { leadId, conversaId, motivo })`

- [ ] **Passo 1: Escrever o teste de conversas**

`src/lib/crm/conversas.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import {
  agendarResposta, agendarToque, limparAgendamento, soltarLock, registrarFalha,
  registrarToqueEnviado, pausarCiclo, reiniciarCiclo, pausarIa, retomarIa,
  marcarLida, MS_POR_TENTATIVA,
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
  assert.ok(new Date(p.responder_em).getTime() >= antes + 8000);
  // Mensagem nova reabre o crédito de tentativas.
  assert.equal(p.tentativas, 0);
  assert.equal(p.ultimo_erro, null);
});

test("agendarToque grava o instante exato calculado pela régua", async () => {
  const admin = criarAdminFake();
  const quando = "2026-08-10T12:00:00.000Z";
  await agendarToque(admin, "C1", quando);

  const p = payloadUpdate(admin);
  assert.equal(p.responder_em, quando);
  assert.equal(p.motivo_agendamento, "followup");
  assert.equal(p.tentativas, 0);
});

test("registrarToqueEnviado guarda em que toque o ciclo está", async () => {
  const admin = criarAdminFake();
  await registrarToqueEnviado(admin, "C1", 3);
  const p = payloadUpdate(admin);
  assert.equal(p.followup_toque, 3);
  // A coluna antiga vira "algum toque já saiu neste ciclo".
  assert.equal(p.followup_enviado, true);
});

test("registrarToqueEnviado recusa toque fora de 1..4", async () => {
  const admin = criarAdminFake();
  await assert.rejects(() => registrarToqueEnviado(admin, "C1", 5), /toque/i);
  assert.equal(admin.chamadas.length, 0, "não pode encostar no banco com valor inválido");
});

test("pausarCiclo grava a data e desliga o agendamento", async () => {
  const admin = criarAdminFake();
  await pausarCiclo(admin, "C1", "2026-09-07T12:00:00.000Z");
  const p = payloadUpdate(admin);
  assert.equal(p.ciclo_pausado_ate, "2026-09-07T12:00:00.000Z");
  assert.equal(p.responder_em, null);
  assert.equal(p.processando_em, null);
});

test("reiniciarCiclo zera toque e pausa para um novo ciclo", async () => {
  const admin = criarAdminFake();
  await reiniciarCiclo(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.followup_toque, 0);
  assert.equal(p.followup_enviado, false);
  assert.equal(p.ciclo_pausado_ate, null);
});

test("limparAgendamento zera responder_em, motivo e lock", async () => {
  const admin = criarAdminFake();
  await limparAgendamento(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.responder_em, null);
  assert.equal(p.motivo_agendamento, null);
  assert.equal(p.processando_em, null);
});

test("soltarLock preserva o agendamento que o turno acabou de fazer", async () => {
  const admin = criarAdminFake();
  await soltarLock(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.processando_em, null);
  assert.equal("responder_em" in p, false, "o próximo toque não pode ser apagado aqui");
});

test("registrarFalha aplica backoff exponencial e solta o lock", async () => {
  const admin = criarAdminFake();
  const antes = Date.now();
  await registrarFalha(admin, "C1", 2, "openai 503");

  const p = payloadUpdate(admin);
  assert.equal(p.tentativas, 2);
  assert.equal(p.ultimo_erro, "openai 503");
  assert.equal(p.processando_em, null);
  assert.ok(new Date(p.responder_em).getTime() >= antes + MS_POR_TENTATIVA * 4);
});

test("registrarFalha na 3ª tentativa desiste em vez de reagendar", async () => {
  const admin = criarAdminFake();
  await registrarFalha(admin, "C1", 3, "openai 503");
  assert.equal(payloadUpdate(admin).responder_em, null, "na 3ª quem assume é o Pedro");
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

- [ ] **Passo 2: Escrever o teste do opt-out**

`src/lib/crm/nao-perturbe.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import { registrarNaoPerturbe } from "./nao-perturbe.server.ts";

const CTX = { leadId: "L1", conversaId: "C1", motivo: "pediu para parar de receber mensagem" };

test("liga nao_perturbe e escala no mesmo movimento", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const lead = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(lead?.payload.nao_perturbe, true);
  assert.equal(lead?.payload.precisa_atencao, true, "o Pedro precisa saber que o lead saiu");
});

test("registra o evento com o motivo, para auditoria", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nao_perturbe");
  assert.match(evento?.payload.detalhe.motivo, /parar/);
});

test("apaga qualquer agendamento pendente e pausa a IA", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, CTX);

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.ok(updates.some((u) => u.payload.responder_em === null), "nenhum toque pode sobrar");
  assert.ok(updates.some((u) => u.payload.pausada_pela_ia === true));
});

test("funciona sem conversaId (opt-out vindo de fora da conversa)", async () => {
  const admin = criarAdminFake();
  await registrarNaoPerturbe(admin, { leadId: "L1", conversaId: null, motivo: "pediu no telefone" });
  assert.equal(admin.chamadas.some((c) => c.tabela === "conversas"), false);
  const lead = admin.chamadas.find((c) => c.tabela === "leads");
  assert.equal(lead?.payload.nao_perturbe, true);
});
```

- [ ] **Passo 3: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/crm/conversas.server.test.ts src/lib/crm/nao-perturbe.server.test.ts
```

Esperado: FALHA com "Cannot find module './conversas.server.ts'".

- [ ] **Passo 4: Implementar `conversas.server.ts`**

```ts
// Agendamento, lock, pausa e régua da conversa. O worker (src/lib/worker) varre
// por responder_em; tudo que mexe nessa coluna passa por aqui.
//
// O follow-up REUSA o mesmo agendamento da resposta: um loop, um lock, um
// caminho de erro. O cancelamento sai de graça — se o lead responder antes, o
// webhook reagenda com motivo "resposta" e o toque simplesmente deixa de
// existir.
import { TOTAL_DE_TOQUES } from "./regua.ts";

/** Base do backoff: 30s, 60s, 120s. */
export const MS_POR_TENTATIVA = 30_000;

/** Depois de 3 falhas seguidas o agente desiste e o lead vira problema do Pedro. */
export const MAX_TENTATIVAS = 3;

export async function agendarResposta(
  admin: any,
  conversaId: string,
  atrasoMs: number,
): Promise<void> {
  await admin
    .from("conversas")
    .update({
      responder_em: new Date(Date.now() + atrasoMs).toISOString(),
      motivo_agendamento: "resposta",
      // Mensagem nova reabre o crédito: uma falha de ontem não pode condenar a
      // resposta de hoje.
      tentativas: 0,
      ultimo_erro: null,
    })
    .eq("id", conversaId);
}

/** Agenda um toque da régua no instante exato que `planejarProximoToque` devolveu. */
export async function agendarToque(
  admin: any,
  conversaId: string,
  quandoIso: string,
): Promise<void> {
  await admin
    .from("conversas")
    .update({
      responder_em: quandoIso,
      motivo_agendamento: "followup",
      tentativas: 0,
      ultimo_erro: null,
    })
    .eq("id", conversaId);
}

export async function registrarToqueEnviado(
  admin: any,
  conversaId: string,
  toque: number,
): Promise<void> {
  if (!Number.isInteger(toque) || toque < 1 || toque > TOTAL_DE_TOQUES) {
    throw new Error(`toque ${toque} fora da cadência (1..${TOTAL_DE_TOQUES})`);
  }
  await admin
    .from("conversas")
    .update({ followup_toque: toque, followup_enviado: true })
    .eq("id", conversaId);
}

/** Pausa obrigatória de 30 dias depois do 4º toque sem resposta. */
export async function pausarCiclo(
  admin: any,
  conversaId: string,
  ateIso: string,
): Promise<void> {
  await admin
    .from("conversas")
    .update({
      ciclo_pausado_ate: ateIso,
      responder_em: null,
      motivo_agendamento: null,
      processando_em: null,
    })
    .eq("id", conversaId);
}

/** Zera o ciclo — usado quando um novo ciclo pode começar (link novo). */
export async function reiniciarCiclo(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ followup_toque: 0, followup_enviado: false, ciclo_pausado_ate: null })
    .eq("id", conversaId);
}

export async function limparAgendamento(admin: any, conversaId: string): Promise<void> {
  await admin
    .from("conversas")
    .update({ responder_em: null, motivo_agendamento: null, processando_em: null })
    .eq("id", conversaId);
}

/**
 * Solta só o lock, preservando responder_em.
 *
 * É o que o worker usa quando o turno JÁ agendou o próximo toque: chamar
 * limparAgendamento ali apagaria a régua que o agente acabou de montar.
 */
export async function soltarLock(admin: any, conversaId: string): Promise<void> {
  await admin.from("conversas").update({ processando_em: null }).eq("id", conversaId);
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
      "id, nome, telefone, estagio, precisa_atencao, nao_perturbe, nao_lidas," +
        " ultima_mensagem_em, ultima_mensagem_preview, ultima_mensagem_direcao," +
        " conversas(id, pausada_pela_ia, followup_toque, ciclo_pausado_ate)",
    )
    .order("ultima_mensagem_em", { ascending: false })
    .limit(limite);
  return data ?? [];
}
```

- [ ] **Passo 5: Implementar `nao-perturbe.server.ts`**

```ts
// Opt-out permanente. O lead pediu para parar — e "parar" aqui é definitivo:
// nenhum toque dispara de novo, em nenhum estágio, e a conversa vai para o
// Pedro. Só ele desfaz, à mão, no banco.
//
// Fica fora de leads.server.ts de propósito: o opt-out mexe em lead, conversa e
// evento no mesmo movimento, e nenhum desses módulos é dono dos três.
import { limparAgendamento, pausarIa } from "./conversas.server.ts";

export type ParamsNaoPerturbe = {
  leadId: string;
  /** Pode ser null quando o pedido não veio pela conversa. */
  conversaId?: string | null;
  motivo: string;
};

export async function registrarNaoPerturbe(
  admin: any,
  params: ParamsNaoPerturbe,
): Promise<void> {
  const motivo = params.motivo?.trim() || "lead pediu para não receber mais mensagens";

  await admin
    .from("leads")
    // precisa_atencao junto: o Pedro tem que saber que perdeu o canal com este
    // lead, senão o opt-out vira um silêncio que ninguém percebe.
    .update({ nao_perturbe: true, precisa_atencao: true })
    .eq("id", params.leadId);

  await admin
    .from("eventos_lead")
    .insert({ lead_id: params.leadId, tipo_evento: "nao_perturbe", detalhe: { motivo } });

  if (params.conversaId) {
    await limparAgendamento(admin, params.conversaId);
    await pausarIa(admin, params.conversaId);
  }
}
```

- [ ] **Passo 6: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/crm/conversas.server.test.ts src/lib/crm/nao-perturbe.server.test.ts
```

Esperado: PASSA, 13 + 4 testes.

- [ ] **Passo 7: Commit**

```bash
git add src/lib/crm/conversas.server.ts src/lib/crm/conversas.server.test.ts \
        src/lib/crm/nao-perturbe.server.ts src/lib/crm/nao-perturbe.server.test.ts
git commit -m "feat(crm): agendamento com regua de toques, ciclo pausado e opt-out"
```

---

## Task 6: `politica.ts` — quem fala, quando fala e em que modo (puro)

**Arquivos:**
- Criar: `src/lib/agente/politica.ts`
- Testar: `src/lib/agente/politica.test.ts`

**Interfaces:**
- Consome: `cicloEstaPausado`, `TOTAL_DE_TOQUES` (Task 4)
- Produz:
  - `JANELA_HISTORICO = 30`, `MS_ENTRE_TOQUES = 86_400_000`
  - `type MotivoRecusa` — 9 motivos
  - `decidirTurno(ctx): { responder: true } | { responder: false; motivo: MotivoRecusa }`
  - `definirModo(lead: { estagio: string }): "venda" | "pos_venda"`
  - `pediuParaParar(texto: string | null | undefined): boolean`
  - `recortarHistorico<T>(mensagens: T[]): T[]`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/politica.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidirTurno, definirModo, pediuParaParar, recortarHistorico,
  JANELA_HISTORICO, MS_ENTRE_TOQUES,
} from "./politica.ts";

const AGORA = Date.parse("2026-08-20T12:00:00.000Z");

const OK = {
  agenteAtivo: true,
  motivo: "resposta" as const,
  pausada: false,
  precisaAtencao: false,
  naoPerturbe: false,
  temTelefone: true,
  ultimoRemetente: "lead",
  toqueAtual: 0,
  cicloPausadoAte: null as string | null,
  ultimaMensagemIaMs: null as number | null,
  agoraMs: AGORA,
};

const TOQUE = { ...OK, motivo: "followup" as const, ultimoRemetente: "ia" };

test("turno normal responde", () => {
  assert.deepEqual(decidirTurno(OK), { responder: true });
});

test("agente desligado por env não responde", () => {
  assert.deepEqual(decidirTurno({ ...OK, agenteAtivo: false }), {
    responder: false, motivo: "agente_desligado",
  });
});

test("opt-out cala o agente nos DOIS motivos, para sempre", () => {
  assert.deepEqual(decidirTurno({ ...OK, naoPerturbe: true }), {
    responder: false, motivo: "nao_perturbe",
  });
  assert.deepEqual(decidirTurno({ ...TOQUE, naoPerturbe: true }), {
    responder: false, motivo: "nao_perturbe",
  });
});

test("conversa assumida pelo Pedro não responde", () => {
  assert.equal(decidirTurno({ ...OK, pausada: true }).responder, false);
  assert.equal(decidirTurno({ ...TOQUE, pausada: true }).responder, false);
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

test("resposta cuja última mensagem é da própria IA não acontece", () => {
  assert.deepEqual(decidirTurno({ ...OK, ultimoRemetente: "ia" }), {
    responder: false, motivo: "sem_mensagem_do_lead",
  });
});

test("toque PODE rodar com a última mensagem sendo da IA", () => {
  // É exatamente o caso: mandamos o link e o lead não voltou.
  assert.deepEqual(decidirTurno(TOQUE), { responder: true });
});

test("o ciclo acaba no 4º toque — não existe 5º", () => {
  assert.deepEqual(decidirTurno({ ...TOQUE, toqueAtual: 4 }), {
    responder: false, motivo: "ciclo_encerrado",
  });
});

test("durante a pausa de 30 dias nenhum toque sai", () => {
  assert.deepEqual(
    decidirTurno({ ...TOQUE, toqueAtual: 4, cicloPausadoAte: "2026-09-19T12:00:00.000Z" }),
    { responder: false, motivo: "ciclo_pausado" },
  );
  // Pausa vencida com ciclo ainda em aberto volta a permitir toque.
  assert.deepEqual(
    decidirTurno({ ...TOQUE, toqueAtual: 1, cicloPausadoAte: "2026-08-19T12:00:00.000Z" }),
    { responder: true },
  );
});

test("no máximo um toque por dia (trava contra bug de agendamento)", () => {
  const duasHorasAtras = AGORA - 2 * 3600_000;
  assert.deepEqual(decidirTurno({ ...TOQUE, toqueAtual: 1, ultimaMensagemIaMs: duasHorasAtras }), {
    responder: false, motivo: "toque_recente_demais",
  });

  const ontem = AGORA - MS_ENTRE_TOQUES - 1000;
  assert.deepEqual(
    decidirTurno({ ...TOQUE, toqueAtual: 1, ultimaMensagemIaMs: ontem }),
    { responder: true },
  );
});

test("a trava de 1 por dia não atrapalha a resposta a uma mensagem do lead", () => {
  // O lead escreveu agora; responder 5 minutos depois da IA é normal.
  const cincoMinAtras = AGORA - 5 * 60_000;
  assert.deepEqual(decidirTurno({ ...OK, ultimaMensagemIaMs: cincoMinAtras }), { responder: true });
});

test("modo pós-venda só depois que o lead virou cliente", () => {
  assert.equal(definirModo({ estagio: "convertido" }), "pos_venda");
  assert.equal(definirModo({ estagio: "qualificando" }), "venda");
  assert.equal(definirModo({ estagio: "link_enviado" }), "venda");
  assert.equal(definirModo({ estagio: "" }), "venda");
});

test("pediuParaParar reconhece o pedido de opt-out", () => {
  for (const texto of [
    "para",
    "PARE",
    "para de me mandar mensagem",
    "não quero mais receber nada",
    "nao quero mais mensagens",
    "me tira dessa lista por favor",
    "me remove da lista",
    "não me manda mais mensagem",
    "quero sair da lista",
    "me descadastra",
  ]) {
    assert.equal(pediuParaParar(texto), true, `deveria reconhecer: ${texto}`);
  }
});

test("pediuParaParar não confunde conversa normal com opt-out", () => {
  for (const texto of [
    "não quero mais a T1, quero a T3",
    "para qual conta cai o dinheiro?",
    "me manda o link",
    "parcela em quantas vezes?",
    "vou parar de usar a maquininha do concorrente",
    "",
    null,
  ]) {
    assert.equal(pediuParaParar(texto as any), false, `falso positivo em: ${texto}`);
  }
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
// Puro: as guardas que decidem se o turno acontece, e em que modo. Ficam fora do
// agente.server.ts para serem testáveis sem banco e sem OpenAI — são elas que
// impedem o agente de falar quando não deve, que é o erro mais caro possível.
import { cicloEstaPausado, MS_POR_DIA, TOTAL_DE_TOQUES } from "../crm/regua.ts";

/** Quantas mensagens do histórico vão para o modelo. Controla custo e latência. */
export const JANELA_HISTORICO = 30;

/** Trava de segurança: no máximo um toque por dia, por conversa. */
export const MS_ENTRE_TOQUES = MS_POR_DIA;

export type MotivoRecusa =
  | "agente_desligado"
  | "nao_perturbe"
  | "conversa_pausada"
  | "lead_escalado"
  | "lead_sem_telefone"
  | "sem_mensagem_do_lead"
  | "ciclo_encerrado"
  | "ciclo_pausado"
  | "toque_recente_demais";

export type ContextoTurno = {
  agenteAtivo: boolean;
  motivo: "resposta" | "followup";
  pausada: boolean;
  precisaAtencao: boolean;
  /** leads.nao_perturbe — o lead pediu para parar. É definitivo. */
  naoPerturbe: boolean;
  temTelefone: boolean;
  /** remetente da última mensagem da conversa: "lead" | "ia" | "humano" */
  ultimoRemetente: string;
  /** conversas.followup_toque — quantos toques já saíram neste ciclo. */
  toqueAtual: number;
  cicloPausadoAte: string | null;
  /** timestamp da última mensagem que saiu daqui (IA ou Pedro). */
  ultimaMensagemIaMs: number | null;
  agoraMs: number;
};

export type Decisao = { responder: true } | { responder: false; motivo: MotivoRecusa };

export function decidirTurno(ctx: ContextoTurno): Decisao {
  if (!ctx.agenteAtivo) return { responder: false, motivo: "agente_desligado" };
  // Antes de precisa_atencao: o opt-out também liga aquela flag, e o motivo
  // preciso é o que aparece no log do worker.
  if (ctx.naoPerturbe) return { responder: false, motivo: "nao_perturbe" };
  if (ctx.pausada) return { responder: false, motivo: "conversa_pausada" };
  if (ctx.precisaAtencao) return { responder: false, motivo: "lead_escalado" };
  if (!ctx.temTelefone) return { responder: false, motivo: "lead_sem_telefone" };

  if (ctx.motivo === "followup") {
    if (ctx.toqueAtual >= TOTAL_DE_TOQUES) return { responder: false, motivo: "ciclo_encerrado" };
    if (cicloEstaPausado(ctx.cicloPausadoAte, ctx.agoraMs)) {
      return { responder: false, motivo: "ciclo_pausado" };
    }
    // Trava contra bug de agendamento: dois toques no mesmo dia viram
    // perseguição, e é o próprio material que proíbe.
    if (
      ctx.ultimaMensagemIaMs !== null &&
      ctx.agoraMs - ctx.ultimaMensagemIaMs < MS_ENTRE_TOQUES
    ) {
      return { responder: false, motivo: "toque_recente_demais" };
    }
    // O toque existe justamente porque o lead NÃO respondeu: aqui não se exige
    // mensagem dele.
    return { responder: true };
  }

  // Resposta normal: se a última mensagem não é do lead, o agendamento ficou
  // órfão (ex.: o Pedro respondeu no meio). Responder seria falar sozinho.
  if (ctx.ultimoRemetente !== "lead") return { responder: false, motivo: "sem_mensagem_do_lead" };

  return { responder: true };
}

/**
 * Venda até o lead comprar; pós-venda depois disso.
 *
 * O gatilho é o estágio `convertido`, que só a tool registrar_resultado_compra
 * grava — ou seja, o modo muda pela palavra do lead, que é a única confirmação
 * de compra que existe (a Ton não expõe isso).
 */
export function definirModo(lead: { estagio: string }): "venda" | "pos_venda" {
  return lead.estagio === "convertido" ? "pos_venda" : "venda";
}

const PEDIDOS_CURTOS = new Set(["para", "pare", "parar", "stop", "sair", "cancelar"]);

const PADROES_DE_PARADA = [
  /par(a|e|ar)\s+de\s+(me\s+)?(mandar|enviar|encher|chamar)/,
  /n(a|ã)o\s+quero\s+mais\s+(receber|mensagem|mensagens|nada|contato)/,
  /n(a|ã)o\s+me\s+(mande|manda|envie|envia|perturbe|perturba|incomode|chame|chama)/,
  /(me\s+)?(tira|tire|remove|remova|exclui|exclua)\s+(me\s+)?(da|dessa|desta|de sua|da sua)\s+lista/,
  /sair\s+d(a|essa|esta)\s+lista/,
  /descadastr/,
];

/**
 * Rede de segurança determinística para o opt-out.
 *
 * O modelo também tem a tool, mas pedir para parar é o único caso em que errar
 * custa o relacionamento inteiro — então não depende só do julgamento dele.
 */
export function pediuParaParar(texto: string | null | undefined): boolean {
  if (!texto) return false;

  const limpo = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[!.,;:?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpo) return false;
  // "para" sozinho é opt-out; "para qual conta cai?" não é.
  if (PEDIDOS_CURTOS.has(limpo)) return true;

  return PADROES_DE_PARADA.some((padrao) => padrao.test(limpo));
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

Esperado: PASSA, 17 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/politica.ts src/lib/agente/politica.test.ts
git commit -m "feat(agente): politica com regua, opt-out e modo pos-venda"
```

---

## Task 7: `prompt.ts` — system prompt por modo e instrução do toque (puro)

**Arquivos:**
- Criar: `src/lib/agente/prompt.ts`
- Testar: `src/lib/agente/prompt.test.ts`

**Interfaces:**
- Consome: `conhecimento.ts` (Task 3), `links.ts` (Task 2, só o mapa de nomes — nunca a URL)
- Produz:
  - `montarSystemPrompt({ lead, modo }): string`
  - `instrucaoDoToque(toque: number): string`
  - `montarMensagens(systemPrompt, historico): MensagemChat[]`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/prompt.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { CANAL_OFICIAL_TON, TAXAS, ANGULO_DO_TOQUE } from "./conhecimento.ts";
import { montarSystemPrompt, instrucaoDoToque, montarMensagens } from "./prompt.ts";

const LEAD = { nome: "Ana", estagio: "qualificando", maquina_interesse: null };

test("no modo venda o prompt traz a tabela de taxas e as objeções", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  assert.ok(p.includes(TAXAS));
  assert.match(p, /Quebra de objeções/);
});

test("no modo pós-venda o prompt traz o roteiro de suporte e o canal oficial", () => {
  const p = montarSystemPrompt({ lead: { ...LEAD, estagio: "convertido" }, modo: "pos_venda" });
  assert.match(p, /Tente resolver/);
  assert.ok(p.includes(CANAL_OFICIAL_TON));
  // Não faz sentido gastar token com objeção de venda para quem já comprou.
  assert.equal(p.includes("Quebra de objeções"), false);
});

test("o prompt inclui nome, estágio e máquina do lead", () => {
  const p = montarSystemPrompt({
    lead: { nome: "Ana", estagio: "link_enviado", maquina_interesse: "T3 Smart" },
    modo: "venda",
  });
  assert.match(p, /Ana/);
  assert.match(p, /link_enviado/);
  assert.match(p, /T3 Smart/);
});

test("lead sem nome não vira 'null' no prompt", () => {
  const p = montarSystemPrompt({
    lead: { nome: null, estagio: "novo", maquina_interesse: null },
    modo: "venda",
  });
  assert.equal(p.includes("null"), false);
});

test("NENHUMA URL entra no prompt — o modelo só escolhe produto", () => {
  process.env.TON_REFERRER = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";
  for (const modo of ["venda", "pos_venda"] as const) {
    const p = montarSystemPrompt({ lead: LEAD, modo });
    assert.equal(p.includes("ton.com.br/checkout"), false, `${modo} vazou checkout`);
    assert.equal(p.includes("ton.com.br/catalogo"), false, `${modo} vazou catálogo`);
    assert.equal(p.includes("CEA4255F"), false, `${modo} vazou o referrer`);
    assert.equal(p.includes("referrer="), false, `${modo} vazou parâmetro de link`);
  }
});

test("a única URL do prompt é o canal de suporte da Ton", () => {
  // O canal de ajuda PODE aparecer: é o que a IA entrega ao encaminhar. Link de
  // venda, esse não — ele só existe dentro da tool.
  for (const modo of ["venda", "pos_venda"] as const) {
    const p = montarSystemPrompt({ lead: LEAD, modo });
    const urls = new Set(
      (p.match(/https?:\/\/\S+/g) ?? []).map((u) => u.replace(/[.,;:)]+$/, "")),
    );
    assert.deepEqual([...urls], ["https://ajuda.ton.com.br/"], `${modo} vazou URL`);
  }
});

test("o prompt lista os productId que o modelo pode escolher", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  assert.match(p, /TONMEGA_TIER_SMART_POS/);
  assert.match(p, /TONBLACK_TIER_SMART_POS/);
  assert.match(p, /TONMEGA_TIER_S920/);
  assert.match(p, /TONMEGA_TIER_D195/);
  assert.match(p, /catalogo/);
});

test("produto sem nome no material não é oferecido ao modelo", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  assert.equal(p.includes("D150"), false);
});

test("o prompt explica as quatro tools, inclusive as novas", () => {
  const p = montarSystemPrompt({ lead: LEAD, modo: "venda" });
  for (const tool of [
    "atualizar_lead",
    "registrar_link_enviado",
    "registrar_resultado_compra",
    "escalar_para_humano",
  ]) {
    assert.match(p, new RegExp(tool), `${tool} não foi explicada`);
  }
});

test("instrucaoDoToque muda de ângulo a cada toque", () => {
  const textos = [1, 2, 3, 4].map((n) => instrucaoDoToque(n));
  assert.equal(new Set(textos).size, 4);
  assert.ok(textos[0].includes(ANGULO_DO_TOQUE[1]));
  assert.ok(textos[3].includes(ANGULO_DO_TOQUE[4]));
});

test("toda instrução de toque proíbe urgência inventada e repetição", () => {
  for (const n of [1, 2, 3, 4]) {
    const t = instrucaoDoToque(n).toLowerCase();
    assert.match(t, /não invente prazo|nao invente prazo/);
    assert.match(t, /não repita|nao repita/);
    assert.match(t, /uma (única )?mensagem/);
  }
});

test("toque fora da cadência não gera instrução de toque", () => {
  assert.throws(() => instrucaoDoToque(5), /cadência|cadencia/i);
  assert.throws(() => instrucaoDoToque(0), /cadência|cadencia/i);
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

test("áudio entra pela transcrição, e sem ela vira marcador", () => {
  const comTexto = montarMensagens("SYS", [
    { remetente: "lead", tipo: "audio", conteudo: null, transcricao: "quero uma maquininha" },
  ]);
  assert.equal(comTexto[1].content, "quero uma maquininha");

  const semTexto = montarMensagens("SYS", [
    { remetente: "lead", tipo: "audio", conteudo: null, transcricao: null },
  ]);
  assert.match(semTexto[1].content ?? "", /áudio/i);
});

test("imagem vira marcador de texto nesta fatia", () => {
  const msgs = montarMensagens("SYS", [{ remetente: "lead", tipo: "imagem", conteudo: null }]);
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

Esperado: FALHA com "Cannot find module './prompt.ts'".

- [ ] **Passo 3: Implementar**

`src/lib/agente/prompt.ts`:

```ts
// Puro: monta o system prompt (por modo) e converte o histórico do banco em
// mensagens de chat.
//
// O prompt NUNCA contém URL. O modelo escolhe um productId da lista abaixo e a
// tool registrar_link_enviado devolve o endereço pronto — assim não há como ele
// colar link cedo, digitar errado ou vazar o referrer numa conversa qualquer.
import {
  ANGULO_DO_TOQUE,
  CONHECIMENTO_POS_VENDA,
  CONHECIMENTO_VENDA,
  REGRAS_ESCALACAO,
} from "./conhecimento.ts";
import { PRODUTOS } from "./links.ts";
import { TOTAL_DE_TOQUES } from "../crm/regua.ts";

export type ModoDoAgente = "venda" | "pos_venda";

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

/** Só produtos com nome comercial no material entram na lista do modelo. */
function catalogoParaOModelo(): string {
  const linhas = Object.entries(PRODUTOS)
    .filter(([, dados]) => dados.nome !== null)
    .map(([id, dados]) => `- ${id} — ${dados.nome}`);

  return [
    "- catalogo — quando o cliente ainda não escolheu a máquina; ele navega e decide",
    ...linhas,
  ].join("\n");
}

const COMO_USAR_AS_TOOLS = `
## As suas tools

- **atualizar_lead** — grave o que descobrir: nome, máquina de interesse e estágio da conversa.
  Chame assim que souber algo novo, sem esperar o fim do papo.
- **registrar_link_enviado** — você escolhe o PRODUTO e ela devolve o link pronto para você
  colar na resposta. **Você nunca escreve endereço nenhum.** Chame só depois de qualificar e
  quando o cliente demonstrar intenção (perguntou como pega, disse que quer). Se ele ainda não
  decidiu a máquina, escolha "catalogo".
- **registrar_resultado_compra** — quando o cliente disser o que aconteceu:
  "comprou" (aí você entra em modo pós-venda), "nao_comprou" (mande o motivo em detalhe e
  quebre a objeção na mesma mensagem, sem desistir) ou "nao_perturbe" (ele pediu para parar).
- **escalar_para_humano** — passa a conversa para o Pedro e encerra o seu turno.

### Produtos que você pode escolher em registrar_link_enviado

${"${catalogoParaOModelo()}"}

O Ton Black só existe para CNPJ e só nos níveis T3 e T3 Smart — não ofereça para CPF.
`.trim();

export function montarSystemPrompt(params: {
  lead: LeadNoPrompt;
  modo: ModoDoAgente;
}): string {
  const { lead, modo } = params;
  const nome = lead.nome?.trim();
  const maquina = lead.maquina_interesse?.trim();

  const estado = [
    nome ? `Nome: ${nome}` : "Nome: ainda não sabemos — descubra naturalmente na conversa.",
    `Estágio no funil: ${lead.estagio}`,
    maquina ? `Máquina de interesse: ${maquina}` : "Máquina de interesse: ainda não definida.",
  ].join("\n");

  const base = modo === "pos_venda" ? CONHECIMENTO_POS_VENDA : CONHECIMENTO_VENDA;

  return [base, REGRAS_ESCALACAO, COMO_USAR_AS_TOOLS, "## Estado deste lead", estado].join(
    "\n\n",
  );
}

/**
 * O gatilho de um toque da régua. Entra como mensagem `system` do turno, não
 * como fala do cliente — não existe mensagem nova do lead aqui.
 *
 * O histórico completo vai junto no turno; é ele que impede a repetição de
 * argumento, que é a regra dura do material.
 */
export function instrucaoDoToque(toque: number): string {
  if (!Number.isInteger(toque) || toque < 1 || toque > TOTAL_DE_TOQUES) {
    throw new Error(`toque ${toque} está fora da cadência (1..${TOTAL_DE_TOQUES})`);
  }

  return [
    `Você está no toque ${toque} de ${TOTAL_DE_TOQUES} do acompanhamento. O cliente recebeu o`,
    "link e não voltou a falar.",
    "",
    `Ângulo deste toque: ${ANGULO_DO_TOQUE[toque as 1 | 2 | 3 | 4]}`,
    "",
    "Regras deste turno:",
    "- Mande uma única mensagem, curta, que caiba em uma tela de WhatsApp.",
    "- Não repita argumento que já apareceu nesta conversa. Cada toque precisa de motivo novo.",
    "- Não invente prazo, cupom que está acabando nem escassez. Urgência falsa é proibida.",
    "- Não cole o link de novo e não cobre resposta.",
    "- Só use as tools atualizar_lead, registrar_resultado_compra ou escalar_para_humano.",
  ].join("\n");
}

/** O que o lead escreveu, resolvendo áudio e mídia para texto. */
function textoDaMensagem(m: MensagemHistorico): string | null {
  const conteudo = m.conteudo?.trim();
  if (conteudo) return conteudo;

  const transcricao = m.transcricao?.trim();
  if (transcricao) return transcricao;

  // Sem texto e sem transcrição, um marcador é melhor que sumir com a mensagem:
  // o modelo precisa saber que ALGO chegou.
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
    // mesma voz, então entra como assistant.
    mensagens.push({ role: m.remetente === "lead" ? "user" : "assistant", content: texto });
  }

  return mensagens;
}
```

> **Atenção ao escrever o arquivo:** em `COMO_USAR_AS_TOOLS`, `${catalogoParaOModelo()}` é
> interpolação de verdade dentro do template literal — escreva sem aspas ao redor.

- [ ] **Passo 4: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/agente/prompt.test.ts
```

Esperado: PASSA, 17 testes.

- [ ] **Passo 5: Olhar o prompt com os próprios olhos**

```bash
node --experimental-strip-types -e '
const { montarSystemPrompt } = await import("./src/lib/agente/prompt.ts");
const p = montarSystemPrompt({ lead: { nome: "Ana", estagio: "qualificando" }, modo: "venda" });
console.log(p);
console.error("--- caracteres:", p.length);
' | head -80
```

Leia como se fosse o modelo: se alguma instrução for ambígua, é ali que a IA vai errar em
produção. Ajuste o texto (não o teste) antes de seguir.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/agente/prompt.ts src/lib/agente/prompt.test.ts
git commit -m "feat(agente): prompt por modo, catalogo de produtos e instrucao de toque"
```

---

## Task 8: `tools.ts` — link por produto, resultado da compra e escalação

**Arquivos:**
- Criar: `src/lib/agente/tools.ts`
- Testar: `src/lib/agente/tools.test.ts`

**Interfaces:**
- Consome: `ehEstagio` (estagios), `atualizarLead`/`moverEstagio`/`marcarPrecisaAtencao`
  (leads.server), `agendarToque`/`reiniciarCiclo`/`limparAgendamento`/`pausarIa`
  (conversas.server, Task 5), `registrarNaoPerturbe` (Task 5), `montarLink`/`PRODUTOS`/
  `ALVOS_DE_LINK` (Task 2), `planejarProximoToque` (Task 4), `criarAdminFake`
- Produz:
  - `DEFINICOES_TOOLS: unknown[]` — 4 tools, no formato que a Task 8 do plano original confirmou
  - `type ResultadoTool = { conteudo: string; escalou?: boolean }`
  - `executarTool(admin, nome, argumentos, ctx: { leadId, conversaId }): Promise<ResultadoTool>`

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/tools.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";

const CTX = { leadId: "L1", conversaId: "C1" };
const REF = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";

function adminComLead(estagio = "qualificando") {
  return criarAdminFake({
    "leads.select": { data: { id: "L1", estagio }, error: null },
  });
}

function updateDe(admin: any, tabela: string) {
  return admin.chamadas.find((c: any) => c.tabela === tabela && c.operacao === "update")?.payload;
}

test("declara exatamente as quatro tools desta fatia", () => {
  const nomes = (DEFINICOES_TOOLS as any[]).map((t) => t.function.name).sort();
  assert.deepEqual(nomes, [
    "atualizar_lead",
    "escalar_para_humano",
    "registrar_link_enviado",
    "registrar_resultado_compra",
  ]);
});

test("toda tool tem descrição e schema de objeto", () => {
  for (const t of DEFINICOES_TOOLS as any[]) {
    assert.ok(t.function.description?.length > 10, `${t.function.name} sem descrição`);
    assert.equal(t.function.parameters.type, "object");
  }
});

test("o schema do link só aceita produto da lista — o modelo não digita URL", () => {
  const link = (DEFINICOES_TOOLS as any[]).find((t) => t.function.name === "registrar_link_enviado");
  const enumerados = link.function.parameters.properties.produto.enum;
  assert.ok(enumerados.includes("catalogo"));
  assert.ok(enumerados.includes("TONMEGA_TIER_SMART_POS"));
  assert.deepEqual(link.function.parameters.required, ["produto"]);
  // Nenhuma propriedade de texto livre que caiba um endereço.
  assert.equal(Object.keys(link.function.parameters.properties).length, 1);
});

test("o schema do resultado da compra tem os três resultados do adendo", () => {
  const t = (DEFINICOES_TOOLS as any[]).find((x) => x.function.name === "registrar_resultado_compra");
  assert.deepEqual(t.function.parameters.properties.resultado.enum, [
    "comprou",
    "nao_comprou",
    "nao_perturbe",
  ]);
});

test("atualizar_lead grava nome e máquina", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "atualizar_lead", { nome: "Ana", maquina_interesse: "T3 Smart" }, CTX);
  const p = updateDe(admin, "leads");
  assert.equal(p.nome, "Ana");
  assert.equal(p.maquina_interesse, "T3 Smart");
  assert.match(r.conteudo, /ok/i);
});

test("atualizar_lead com estágio inválido devolve erro ao modelo sem gravar", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "atualizar_lead", { estagio: "negociando" }, CTX);
  assert.match(r.conteudo, /inválido|invalido/i);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("registrar_link_enviado devolve o checkout do produto escolhido", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "TONMEGA_TIER_S920" }, CTX);

  assert.match(r.conteudo, /https:\/\/ton\.com\.br\/checkout\/cart\/\?productId=TONMEGA_TIER_S920/);
  assert.match(r.conteudo, new RegExp(`referrer=${REF}`));
  assert.match(r.conteudo, /userTag=tonmega_tier/);
});

test("registrar_link_enviado com catalogo devolve o catálogo", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);
  assert.match(r.conteudo, /https:\/\/ton\.com\.br\/catalogo\//);
  assert.equal(r.conteudo.includes("productId"), false);
});

test("registrar_link_enviado move o estágio e abre o ciclo no toque de 24h", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const antes = Date.now();
  await executarTool(admin, "registrar_link_enviado", { produto: "TONMEGA_TIER_D195" }, CTX);

  assert.equal(updateDe(admin, "leads").estagio, "link_enviado");

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  const zerou = updates.find((u) => u.payload.followup_toque === 0);
  assert.ok(zerou, "um link novo abre um ciclo novo");
  assert.equal(zerou?.payload.ciclo_pausado_ate, null);

  const agendou = updates.find((u) => u.payload.motivo_agendamento === "followup");
  assert.ok(agendou, "tem que agendar o primeiro toque");
  const quando = new Date(agendou!.payload.responder_em).getTime();
  assert.ok(quando >= antes + 86_400_000 - 5_000, "o toque 1 é 24h depois do link");
});

test("produto inventado devolve erro ao modelo e não mexe no lead", async () => {
  process.env.TON_REFERRER = REF;
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_link_enviado", { produto: "T3 Smart" }, CTX);
  assert.match(r.conteudo, /produto/i);
  assert.equal(r.escalou, undefined);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("sem TON_REFERRER escala em vez de mandar link sem indicação", async () => {
  const original = process.env.TON_REFERRER;
  delete process.env.TON_REFERRER;
  try {
    const admin = adminComLead();
    const r = await executarTool(admin, "registrar_link_enviado", { produto: "catalogo" }, CTX);
    assert.equal(r.escalou, true);
    assert.equal(updateDe(admin, "leads").precisa_atencao, true);
  } finally {
    if (original !== undefined) process.env.TON_REFERRER = original;
  }
});

test("resultado comprou converte o lead e encerra a régua", async () => {
  const admin = adminComLead("link_enviado");
  const r = await executarTool(admin, "registrar_resultado_compra", { resultado: "comprou" }, CTX);

  assert.equal(updateDe(admin, "leads").estagio, "convertido");
  const conversa = admin.chamadas.find(
    (c) => c.tabela === "conversas" && c.operacao === "update" && c.payload.responder_em === null,
  );
  assert.ok(conversa, "nenhum toque pode sair depois da compra");
  assert.match(r.conteudo, /pós-venda|pos-venda/i);
});

test("resultado nao_comprou guarda o motivo e manda quebrar a objeção agora", async () => {
  const admin = adminComLead("link_enviado");
  const r = await executarTool(
    admin,
    "registrar_resultado_compra",
    { resultado: "nao_comprou", detalhe: "achou a taxa alta" },
    CTX,
  );

  assert.equal(updateDe(admin, "leads").estagio, "contornando_objecao");
  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead");
  assert.equal(evento?.payload.tipo_evento, "nao_comprou");
  assert.match(evento?.payload.detalhe.motivo, /taxa alta/);
  assert.match(r.conteudo, /objeção|objecao/i);
  assert.equal(r.escalou, undefined, "não desista: o turno continua");
});

test("resultado nao_perturbe é opt-out definitivo e escala", async () => {
  const admin = adminComLead("link_enviado");
  const r = await executarTool(
    admin,
    "registrar_resultado_compra",
    { resultado: "nao_perturbe", detalhe: "pediu para não mandar mais" },
    CTX,
  );

  assert.equal(r.escalou, true);
  const lead = updateDe(admin, "leads");
  assert.equal(lead.nao_perturbe, true);
  assert.equal(lead.precisa_atencao, true);
});

test("resultado inventado devolve erro sem gravar nada", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "registrar_resultado_compra", { resultado: "talvez" }, CTX);
  assert.match(r.conteudo, /resultado/i);
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("escalar_para_humano marca atenção, pausa a conversa e sinaliza escalou", async () => {
  const admin = adminComLead();
  const r = await executarTool(admin, "escalar_para_humano", { motivo: "pediu taxa fora da tabela" }, CTX);

  assert.equal(r.escalou, true);
  assert.equal(updateDe(admin, "leads").precisa_atencao, true);
  assert.equal(updateDe(admin, "conversas").pausada_pela_ia, true);
});

test("escalar_para_humano sem motivo ainda escala", async () => {
  const admin = adminComLead();
  assert.equal((await executarTool(admin, "escalar_para_humano", {}, CTX)).escalou, true);
});

test("tool desconhecida devolve erro ao modelo sem lançar", async () => {
  const admin = adminComLead();
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
import {
  agendarToque, limparAgendamento, pausarIa, reiniciarCiclo,
} from "../crm/conversas.server.ts";
import { registrarNaoPerturbe } from "../crm/nao-perturbe.server.ts";
import { planejarProximoToque } from "../crm/regua.ts";
import { ALVOS_DE_LINK, montarLink, PRODUTOS } from "./links.ts";

const RESULTADOS = ["comprou", "nao_comprou", "nao_perturbe"] as const;
type ResultadoCompra = (typeof RESULTADOS)[number];

export const DEFINICOES_TOOLS = [
  {
    type: "function",
    function: {
      name: "atualizar_lead",
      description:
        "Grava o que você descobriu sobre o cliente: o nome dele, qual máquina interessa, e o " +
        "estágio do funil em que a conversa está. Chame assim que souber algo novo.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente, como ele se apresentou" },
          maquina_interesse: {
            type: "string",
            description: "Nível ou modelo que interessa (ex.: T3 Smart, TapTon)",
          },
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
        "Escolha o produto e receba o link pronto para colar na resposta. Use 'catalogo' quando " +
        "o cliente ainda não decidiu a máquina, e o productId do modelo quando ele já decidiu — " +
        "o checkout cai direto no carrinho. Você nunca escreve endereço: só escolhe o produto.",
      parameters: {
        type: "object",
        properties: {
          produto: {
            type: "string",
            enum: [...ALVOS_DE_LINK],
            description: "O produto do checkout, ou 'catalogo' para o cliente escolher",
          },
        },
        required: ["produto"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_resultado_compra",
      description:
        "Registre o que o cliente disse sobre a compra. 'comprou' libera o acompanhamento de " +
        "pós-venda; 'nao_comprou' guarda o motivo e você quebra a objeção na mesma resposta; " +
        "'nao_perturbe' quando ele pediu para não receber mais mensagens.",
      parameters: {
        type: "object",
        properties: {
          resultado: { type: "string", enum: [...RESULTADOS] },
          detalhe: {
            type: "string",
            description: "O que ele disse, nas palavras dele (motivo, objeção, pedido)",
          },
        },
        required: ["resultado"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_para_humano",
      description:
        "Passa a conversa para o Pedro e encerra o seu turno. Use para negociação especial de " +
        "taxa, faixa que não está na sua tabela, cliente irritado, pedido para falar com uma " +
        "pessoa, e para problema de pós-venda que você tentou resolver e não resolveu.",
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

async function registrarEvento(
  admin: any,
  leadId: string,
  tipoEvento: string,
  detalhe: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("eventos_lead")
    .insert({ lead_id: leadId, tipo_evento: tipoEvento, detalhe });
}

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
        return await executarRegistrarLink(admin, argumentos, ctx);
      case "registrar_resultado_compra":
        return await executarResultadoCompra(admin, argumentos, ctx);
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
    typeof argumentos.maquina_interesse === "string"
      ? argumentos.maquina_interesse.trim()
      : undefined;

  await atualizarLead(admin, ctx.leadId, {
    nome: nome || undefined,
    maquina_interesse: maquina || undefined,
  });

  if (estagio !== undefined) await moverEstagio(admin, ctx.leadId, estagio, { origem: "agente" });

  return { conteudo: "ok, lead atualizado" };
}

async function executarRegistrarLink(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const link = montarLink(argumentos.produto);

  if (!link.ok && link.erro === "produto_desconhecido") {
    // Erro do modelo, não do sistema: devolve a lista e deixa ele tentar de novo
    // no mesmo turno, sem sujar o lead.
    return {
      conteudo:
        `Erro: produto "${String(argumentos.produto)}" não existe. ` +
        `Escolha um destes: ${ALVOS_DE_LINK.join(", ")}.`,
    };
  }

  if (!link.ok) {
    // Sem referrer o link não atribui a indicação ao Pedro: a venda acontece e
    // ele não ganha. Melhor não mandar nada e chamar o dono.
    await marcarPrecisaAtencao(admin, ctx.leadId, "TON_REFERRER não configurado");
    await pausarIa(admin, ctx.conversaId);
    return {
      conteudo: "Erro: o link de indicação não está configurado. A conversa foi passada para o Pedro.",
      escalou: true,
    };
  }

  const produto = argumentos.produto as keyof typeof PRODUTOS | "catalogo";
  const rotulo = produto === "catalogo" ? "catálogo" : (PRODUTOS[produto].nome ?? produto);

  await moverEstagio(admin, ctx.leadId, "link_enviado", { origem: "agente", produto });

  // Link novo abre ciclo novo: zera o contador de toques e qualquer pausa
  // herdada de um ciclo anterior.
  await reiniciarCiclo(admin, ctx.conversaId);

  const agora = Date.now();
  const plano = planejarProximoToque(0, agora, agora);
  if (plano.tipo === "toque") await agendarToque(admin, ctx.conversaId, plano.quandoIso);

  return { conteudo: `Link do ${rotulo} para enviar ao cliente: ${link.url}` };
}

async function executarResultadoCompra(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const resultado = argumentos.resultado as ResultadoCompra;
  if (!RESULTADOS.includes(resultado)) {
    return {
      conteudo: `Erro: resultado "${String(resultado)}" é inválido. Use: ${RESULTADOS.join(", ")}.`,
    };
  }

  const detalhe =
    typeof argumentos.detalhe === "string" && argumentos.detalhe.trim()
      ? argumentos.detalhe.trim()
      : "sem detalhe informado";

  if (resultado === "comprou") {
    await moverEstagio(admin, ctx.leadId, "convertido", { origem: "agente", detalhe });
    // A régua morre aqui: quem comprou não recebe toque de remarketing.
    await limparAgendamento(admin, ctx.conversaId);
    return {
      conteudo:
        "ok, cliente convertido. A régua de acompanhamento foi encerrada e você entra em modo " +
        "pós-venda: ajude com cadastro, documentos, ativação e chave Pix.",
    };
  }

  if (resultado === "nao_comprou") {
    await moverEstagio(admin, ctx.leadId, "contornando_objecao", { origem: "agente" });
    await registrarEvento(admin, ctx.leadId, "nao_comprou", { motivo: detalhe });
    return {
      conteudo:
        `ok, registrado que ele não comprou. Motivo: "${detalhe}". Agora quebre essa objeção ` +
        "na sua próxima mensagem, usando o material — não desista e não repita argumento que " +
        "já apareceu na conversa.",
    };
  }

  await registrarNaoPerturbe(admin, {
    leadId: ctx.leadId,
    conversaId: ctx.conversaId,
    motivo: detalhe,
  });
  return {
    conteudo:
      "ok, o lead foi marcado como não perturbe: nenhuma mensagem automática sai mais para " +
      "ele, e o Pedro foi avisado. Não responda mais nada neste turno.",
    escalou: true,
  };
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

Esperado: PASSA, 18 testes.

- [ ] **Passo 5: Ajustar o formato ao spike, se preciso**

Se a Task 8 do plano original mostrou que o endpoint é `/v1/responses`, as tools são achatadas
(`{ type, name, description, parameters }`, sem o envelope `function`). Ajuste
`DEFINICOES_TOOLS` e os dois primeiros testes ao formato real capturado — o resto do arquivo
não muda.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/agente/tools.ts src/lib/agente/tools.test.ts
git commit -m "feat(agente): tools de link por produto, resultado da compra e escalacao"
```

---

## Task 9: `agente.server.ts` — o turno (venda, toque e pós-venda)

**Arquivos:**
- Criar: `src/lib/agente/agente.server.ts`
- Testar: `src/lib/agente/agente.server.test.ts`

**Interfaces:**
- Consome: tudo das Tasks 2–8 mais `listarMensagens`/`enviarTextoDoCrm` (mensagens.server) e
  `chamarOpenAI` (Task 9 do plano original)
- Produz:
  - `MAX_ITERACOES_TOOL = 3`
  - `type ResultadoTurno = { status: "respondeu" | "escalou" | "pulado" | "erro"; motivo?: string; texto?: string; reagendou?: boolean }`
  - `executarTurno(admin, { conversaId, leadId, motivo }, deps?): Promise<ResultadoTurno>`
    com `deps = { chamar?, enviar? }` para injeção em teste

> **`reagendou` é a peça nova.** Num turno de toque, o próprio agente agenda o toque seguinte
> antes de devolver. Se o worker chamasse `limparAgendamento` depois disso, apagaria a régua
> que acabou de ser montada — por isso o resultado diz quem é o dono do `responder_em`.

- [ ] **Passo 1: Escrever o teste que falha**

`src/lib/agente/agente.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { executarTurno } from "./agente.server.ts";

const CTX = { conversaId: "C1", leadId: "L1", motivo: "resposta" as const };
const TOQUE = { ...CTX, motivo: "followup" as const };
const AGORA = Date.now();

function adminDeConversa(sobrescreve: Record<string, any> = {}) {
  return criarAdminFake({
    "conversas.select": {
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: false,
        followup_toque: 0, ciclo_pausado_ate: null,
      },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "qualificando",
        precisa_atencao: false, nao_perturbe: false, maquina_interesse: null,
        link_enviado_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [
        { remetente: "lead", tipo: "texto", conteudo: "oi, quero uma maquininha", timestamp_ms: AGORA },
      ],
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
    chamar: async () => ({ texto: "Oi Ana! Qual o seu tipo de negócio?", toolCalls: [] }),
    enviar: async (_n: string, t: string) => { enviados.push(t); return { messageid: "WA1" }; },
  });

  assert.equal(r.status, "respondeu");
  assert.deepEqual(enviados, ["Oi Ana! Qual o seu tipo de negócio?"]);
});

test("conversa pausada é pulada sem chamar a OpenAI", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: true, followup_toque: 0, ciclo_pausado_ate: null },
      error: null,
    },
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

test("lead com nao_perturbe é pulado sem gastar token", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "link_enviado",
        precisa_atencao: false, nao_perturbe: true,
      },
      error: null,
    },
  });
  let chamou = false;

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => { chamou = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({}),
  });

  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "nao_perturbe");
  assert.equal(chamou, false);
});

test("pedido de parada no texto do lead não passa pelo modelo", async () => {
  // Rede de segurança: opt-out não depende do julgamento do modelo.
  const admin = adminDeConversa({
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "me tira dessa lista", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let chamou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => { chamou = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({}),
  });

  assert.equal(r.status, "escalou");
  assert.equal(chamou, false);
  const lead = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(lead?.payload.nao_perturbe, true);
});

test("tool call é executada e o modelo é chamado de novo com o resultado", async () => {
  process.env.TON_REFERRER = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";
  const admin = adminDeConversa();
  const chamadas: any[][] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      chamadas.push(mensagens);
      if (chamadas.length === 1) {
        return {
          texto: null,
          toolCalls: [{ id: "c1", nome: "registrar_link_enviado", argumentos: { produto: "catalogo" } }],
        };
      }
      return { texto: "Manda ver, é só entrar por aqui", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  assert.equal(chamadas.length, 2, "tem que voltar ao modelo com o resultado da tool");
  assert.ok(chamadas[1].some((m: any) => m.role === "tool"), "o resultado entra como role:tool");
});

test("escalação encerra o turno sem enviar mensagem", async () => {
  const admin = adminDeConversa();
  let enviou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({
      texto: null,
      toolCalls: [{ id: "c1", nome: "escalar_para_humano", argumentos: { motivo: "quer negociar taxa" } }],
    }),
    enviar: async () => { enviou = true; return {}; },
  });

  assert.equal(r.status, "escalou");
  assert.equal(enviou, false);
});

test("lead convertido conversa em modo pós-venda", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "convertido",
        precisa_atencao: false, nao_perturbe: false,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "meu cadastro deu pendência", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let system = "";

  await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      system = mensagens[0].content;
      return { texto: "Vamos resolver: abre o app e veja o que ele pede", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.match(system, /Tente resolver/);
  assert.match(system, /ajuda\.ton\.com\.br/);
  assert.equal(system.includes("Quebra de objeções"), false);
});

test("o toque injeta a instrução do ângulo daquele número", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 1, ciclo_pausado_ate: null },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 5 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "conseguiu concluir?", timestamp_ms: AGORA - 3 * 86_400_000 }],
      error: null,
    },
  });
  let instrucoes: string[] = [];

  const r = await executarTurno(admin, TOQUE, {
    chamar: async (mensagens: any[]) => {
      instrucoes = mensagens.filter((m: any) => m.role === "system").map((m: any) => m.content);
      return { texto: "O que pesou na hora de decidir?", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  const gatilho = instrucoes[instrucoes.length - 1];
  assert.match(gatilho, /toque 2 de 4/);
  assert.match(gatilho, /objeção real/);
  assert.match(gatilho, /não invente prazo/i);
});

test("depois de enviar o toque, o próximo é agendado e o resultado avisa", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 1, ciclo_pausado_ate: null },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 2 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "oi", timestamp_ms: AGORA - 2 * 86_400_000 }],
      error: null,
    },
  });

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => ({ texto: "e aí, o que pesou?", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, true, "o worker não pode apagar o toque recém-agendado");

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.ok(updates.some((u) => u.payload.followup_toque === 2), "grava em que toque parou");
  assert.ok(updates.some((u) => u.payload.motivo_agendamento === "followup"), "agenda o toque 3");
});

test("o 4º toque encerra o ciclo com pausa de 30 dias", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 3, ciclo_pausado_ate: null },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 10 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "oi", timestamp_ms: AGORA - 5 * 86_400_000 }],
      error: null,
    },
  });

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => ({ texto: "fico à disposição!", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  const pausa = admin.chamadas.find(
    (c) => c.tabela === "conversas" && c.operacao === "update" && c.payload.ciclo_pausado_ate,
  );
  assert.ok(pausa, "depois do 4º toque a pausa é obrigatória");
  const ate = new Date(pausa!.payload.ciclo_pausado_ate).getTime();
  assert.ok(ate >= AGORA + 29 * 86_400_000, "a pausa é de 30 dias");
  assert.equal(r.reagendou, undefined, "não há próximo toque para preservar");
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
// O turno do agente: carrega estado, decide se fala e em que modo, conversa com
// o modelo, executa tools, envia a resposta e — quando é um toque da régua —
// agenda o toque seguinte.
//
// NUNCA lança. Quem chama é o worker, e uma exceção aqui deixaria o lock da
// conversa preso. Toda falha volta como { status: "erro", motivo }.
import { enviarTextoDoCrm, listarMensagens } from "../crm/mensagens.server.ts";
import { moverEstagio } from "../crm/leads.server.ts";
import { agendarToque, pausarCiclo, registrarToqueEnviado } from "../crm/conversas.server.ts";
import { registrarNaoPerturbe } from "../crm/nao-perturbe.server.ts";
import { planejarProximoToque } from "../crm/regua.ts";
import { decidirTurno, definirModo, pediuParaParar, recortarHistorico } from "./politica.ts";
import { instrucaoDoToque, montarMensagens, montarSystemPrompt } from "./prompt.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";

/** Quantas rodadas de tool o modelo pode pedir antes de a gente cortar. */
export const MAX_ITERACOES_TOOL = 3;

export type MotivoTurno = "resposta" | "followup";

export type ResultadoTurno = {
  status: "respondeu" | "escalou" | "pulado" | "erro";
  motivo?: string;
  texto?: string;
  /** true = o turno já deixou um agendamento novo; o worker não pode limpá-lo. */
  reagendou?: boolean;
};

export type DepsTurno = {
  chamar?: (
    mensagens: any[],
    tools: unknown[],
  ) => Promise<{ texto: string | null; toolCalls: any[] }>;
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
      .select("id, lead_id, pausada_pela_ia, followup_toque, ciclo_pausado_ate")
      .eq("id", ctx.conversaId)
      .maybeSingle();
    if (!conversa) return { status: "erro", motivo: "conversa não encontrada" };

    const { data: lead } = await admin.from("leads").select("*").eq("id", ctx.leadId).maybeSingle();
    if (!lead) return { status: "erro", motivo: "lead não encontrado" };

    const historico = recortarHistorico(await listarMensagens(admin, ctx.conversaId, 60));
    const ultima = historico[historico.length - 1];
    const ultimaDaCasa = [...historico].reverse().find((m: any) => m.remetente !== "lead");
    const agoraMs = Date.now();

    const decisao = decidirTurno({
      agenteAtivo: process.env.AGENTE_ATIVO !== "false",
      motivo: ctx.motivo,
      pausada: Boolean(conversa.pausada_pela_ia),
      precisaAtencao: Boolean(lead.precisa_atencao),
      naoPerturbe: Boolean(lead.nao_perturbe),
      temTelefone: Boolean(lead.telefone),
      ultimoRemetente: (ultima as any)?.remetente ?? "",
      toqueAtual: Number(conversa.followup_toque ?? 0),
      cicloPausadoAte: conversa.ciclo_pausado_ate ?? null,
      ultimaMensagemIaMs: (ultimaDaCasa as any)?.timestamp_ms ?? null,
      agoraMs,
    });
    if (!decisao.responder) return { status: "pulado", motivo: decisao.motivo };

    // Opt-out antes de qualquer token: pedir para parar é o único caso em que
    // errar custa o relacionamento inteiro, então não depende do modelo.
    if (ctx.motivo === "resposta" && pediuParaParar((ultima as any)?.conteudo)) {
      await registrarNaoPerturbe(admin, {
        leadId: ctx.leadId,
        conversaId: ctx.conversaId,
        motivo: "o lead pediu para parar de receber mensagens",
      });
      return { status: "escalou", motivo: "opt_out" };
    }

    const chamar = deps.chamar ?? (await carregarChamadorPadrao());
    const modo = definirModo({ estagio: String(lead.estagio ?? "") });

    const mensagens: any[] = montarMensagens(
      montarSystemPrompt({
        lead: {
          nome: lead.nome,
          estagio: lead.estagio,
          maquina_interesse: lead.maquina_interesse,
        },
        modo,
      }),
      historico as any,
    );

    const toque = Number(conversa.followup_toque ?? 0) + 1;
    if (ctx.motivo === "followup") {
      // O toque não tem mensagem nova do lead para reagir. Esta instrução é o
      // gatilho do turno — entra como system para o modelo não confundi-la com
      // fala do cliente. O histórico inteiro vai junto: é ele que impede a
      // repetição de argumento.
      mensagens.push({ role: "system", content: instrucaoDoToque(toque) });
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

      if (ctx.motivo !== "followup") return { status: "respondeu", texto };

      return { ...(await fecharToque(admin, ctx, lead, toque, agoraMs)), texto };
    }

    // Estourou o limite: o modelo ficou pedindo tool sem nunca redigir a
    // resposta. Melhor falhar visivelmente do que insistir gastando token.
    return { status: "erro", motivo: "modelo excedeu o limite de iterações de tool" };
  } catch (err: any) {
    return { status: "erro", motivo: err?.message ?? "falha desconhecida no turno" };
  }
}

/**
 * Fecha um toque: registra em que ponto do ciclo ele parou e planeja o que vem
 * depois — o próximo toque, ou a pausa obrigatória de 30 dias.
 */
async function fecharToque(
  admin: any,
  ctx: { conversaId: string; leadId: string },
  lead: any,
  toque: number,
  agoraMs: number,
): Promise<ResultadoTurno> {
  await registrarToqueEnviado(admin, ctx.conversaId, toque);

  // O primeiro toque é o que tira o lead de "link_enviado": daqui em diante ele
  // está em acompanhamento, e é assim que o funil da Fatia 4 vai mostrar.
  if (toque === 1) await moverEstagio(admin, ctx.leadId, "acompanhamento", { origem: "agente" });

  const plano = planejarProximoToque(toque, Date.parse(lead.link_enviado_em ?? ""), agoraMs);

  if (plano.tipo === "toque") {
    await agendarToque(admin, ctx.conversaId, plano.quandoIso);
    return { status: "respondeu", reagendou: true };
  }

  await pausarCiclo(admin, ctx.conversaId, plano.ateIso);
  return { status: "respondeu" };
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

Esperado: PASSA, 13 testes.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/agente.server.ts src/lib/agente/agente.server.test.ts
git commit -m "feat(agente): turno com modo pos-venda, regua de toques e opt-out"
```

---

## Task 10: Worker — loop, lock, órfãos e a régua que não pode ser apagada

**Arquivos:**
- Criar: `src/lib/worker/selecao.ts`
- Criar: `src/lib/worker/loop.server.ts`
- Testar: `src/lib/worker/selecao.test.ts`
- Testar: `src/lib/worker/loop.server.test.ts`
- Modificar: `server.ts` (ligar o loop)

**Interfaces:**
- Consome: `executarTurno` (Task 9), `limparAgendamento`/`soltarLock`/`registrarFalha` (Task 5)
- Produz:
  - `MS_LOCK_ORFAO = 120_000`, `ehLockOrfao(processandoEm, agoraMs): boolean`
  - `processarPendentes(admin, deps?): Promise<number>`
  - `iniciarLoop(admin, deps?): { parar: () => void }`

- [ ] **Passo 1: Escrever os testes que falham**

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
  assert.equal(ehLockOrfao(new Date(AGORA - 10_000).toISOString(), AGORA), false);
});

test("lock mais velho que o limite é órfão", () => {
  // Container reiniciou no meio do turno e deixou a conversa travada.
  assert.equal(ehLockOrfao(new Date(AGORA - MS_LOCK_ORFAO - 1000).toISOString(), AGORA), true);
});

test("lock com data inválida é tratado como órfão", () => {
  // Melhor liberar do que deixar a conversa presa para sempre.
  assert.equal(ehLockOrfao("não é data", AGORA), true);
});
```

`src/lib/worker/loop.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { processarPendentes } from "./loop.server.ts";

/**
 * A varredura de órfãos e a de pendentes batem na mesma tabela; o que as separa
 * é o filtro. O fake registra os filtros, então dá para responder cada uma.
 */
function adminComPendente(motivo: "resposta" | "followup") {
  return criarAdminFake({
    "conversas.select": (chamada: any) => {
      const colunas = chamada.filtros.map(([coluna]: [string, unknown]) => coluna);
      if (!colunas.includes("responder_em")) return { data: [], error: null }; // órfãos
      return {
        data: [{ id: "C1", lead_id: "L1", motivo_agendamento: motivo, tentativas: 0 }],
        error: null,
      };
    },
    // O UPDATE do lock devolve a linha travada: quem recebe linha, processa.
    "conversas.update": { data: [{ id: "C1" }], error: null },
  });
}

function updatesDeConversa(admin: any) {
  return admin.chamadas
    .filter((c: any) => c.tabela === "conversas" && c.operacao === "update")
    .map((c: any) => c.payload);
}

test("processa a conversa vencida e limpa o agendamento no fim", async () => {
  const admin = adminComPendente("resposta");
  const vistos: any[] = [];

  const total = await processarPendentes(admin, {
    turno: async (_a: any, ctx: any) => { vistos.push(ctx); return { status: "respondeu" }; },
  });

  assert.equal(total, 1);
  assert.deepEqual(vistos, [{ conversaId: "C1", leadId: "L1", motivo: "resposta" }]);
  assert.ok(updatesDeConversa(admin).some((p: any) => p.responder_em === null));
});

test("NÃO apaga o toque que o turno acabou de agendar", async () => {
  const admin = adminComPendente("followup");

  await processarPendentes(admin, {
    turno: async () => ({ status: "respondeu", reagendou: true }),
  });

  const limpezas = updatesDeConversa(admin).filter((p: any) => "responder_em" in p && p.responder_em === null);
  assert.equal(limpezas.length, 0, "limparAgendamento aqui mataria a régua");
  // Mas o lock TEM que sair, senão a conversa fica presa até o varredor passar.
  assert.ok(updatesDeConversa(admin).some((p: any) => p.processando_em === null));
});

test("turno pulado não é falha: limpa o agendamento e não conta tentativa", async () => {
  const admin = adminComPendente("followup");

  await processarPendentes(admin, {
    turno: async () => ({ status: "pulado", motivo: "ciclo_pausado" }),
  });

  const payloads = updatesDeConversa(admin);
  assert.ok(payloads.some((p: any) => p.responder_em === null));
  assert.equal(payloads.some((p: any) => p.tentativas !== undefined), false);
});

test("erro no turno vira backoff com tentativa incrementada", async () => {
  const admin = adminComPendente("resposta");

  await processarPendentes(admin, {
    turno: async () => ({ status: "erro", motivo: "OpenAI 503" }),
  });

  const falha = updatesDeConversa(admin).find((p: any) => p.tentativas === 1);
  assert.ok(falha, "a primeira falha grava tentativas = 1");
  assert.equal(falha.ultimo_erro, "OpenAI 503");
  assert.ok(falha.responder_em, "reagenda para tentar de novo");
});

test("sem candidata, não chama turno nenhum", async () => {
  const admin = criarAdminFake({ "conversas.select": { data: [], error: null } });
  let chamou = false;

  const total = await processarPendentes(admin, {
    turno: async () => { chamou = true; return { status: "respondeu" }; },
  });

  assert.equal(total, 0);
  assert.equal(chamou, false);
});
```

- [ ] **Passo 2: Rodar e ver falhar**

```bash
node --test --experimental-strip-types src/lib/worker/selecao.test.ts src/lib/worker/loop.server.test.ts
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

- [ ] **Passo 4: Implementar o loop**

`src/lib/worker/loop.server.ts`:

```ts
// Loop in-process. Roda dentro do container do EasyPanel — não é cron, não é
// serverless: o processo é persistente e o setInterval sobrevive.
//
// O lock é o próprio UPDATE: marcar processando_em e ver o que voltou. Com um
// container só não há corrida, mas o lock também protege contra dois ticks se
// sobrepondo quando um turno demora mais que o intervalo.
//
// Quem manda no responder_em é o TURNO, não o loop: num toque da régua o agente
// já agenda o próximo antes de devolver, e por isso o loop só solta o lock
// quando o resultado diz `reagendou`.
import { limparAgendamento, registrarFalha, soltarLock } from "../crm/conversas.server.ts";
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
    await soltarLock(admin, conversa.id);
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
  const rodarTurno = deps.turno ?? executarTurno;
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

    const resultado = await rodarTurno(admin, {
      conversaId: conversa.id,
      leadId: conversa.lead_id,
      motivo: conversa.motivo_agendamento === "followup" ? "followup" : "resposta",
    });

    if (resultado.status === "erro") {
      await registrarFalha(
        admin,
        conversa.id,
        (conversa.tentativas ?? 0) + 1,
        resultado.motivo ?? "erro",
      );
      console.warn(`[worker] turno falhou na conversa ${conversa.id}: ${resultado.motivo}`);
    } else if (resultado.reagendou) {
      // O turno já deixou o próximo toque marcado: aqui só o lock sai.
      await soltarLock(admin, conversa.id);
    } else {
      if (resultado.status === "pulado") {
        console.log(`[worker] conversa ${conversa.id} pulada: ${resultado.motivo}`);
      }
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

- [ ] **Passo 5: Ligar no `server.ts`**

Em `server.ts`, logo **antes** do `console.log` final, acrescente:

```ts
// Loop do agente. Só sobe em produção real: exige service role para escrever no
// banco ignorando RLS, e não deve rodar em build/preview.
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

- [ ] **Passo 6: Conferir o nome do export do client**

```bash
grep -n "export" src/integrations/supabase/client.server.ts
```

Se o export não se chamar `supabaseAdmin`, corrija o import acima para o nome real.

- [ ] **Passo 7: Rodar e ver passar**

```bash
node --test --experimental-strip-types src/lib/worker/selecao.test.ts src/lib/worker/loop.server.test.ts
```

Esperado: PASSA, 4 + 5 testes.

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

Esperado: verde, incluindo tudo que a Fatia 1 já tinha.

- [ ] **Passo 10: Commit**

```bash
git add src/lib/worker/ server.ts
git commit -m "feat(worker): loop com lock, orfaos e preservacao do toque agendado"
```

---

## Task 11: Golden set ampliado

**Arquivos:**
- Criar: `src/lib/agente/casos-golden.ts`
- Criar: `src/lib/agente/golden.test.ts`

**Interfaces:**
- Consome: `chamarOpenAI` (Task 9 original), `montarSystemPrompt`/`montarMensagens` (Task 7),
  `DEFINICOES_TOOLS` (Task 8)
- Produz: suíte que só roda com `AGENTE_GOLDEN=1`

- [ ] **Passo 1: Escrever os casos**

`src/lib/agente/casos-golden.ts`:

```ts
// Casos de comportamento do agente. Não são testes de código — são testes de
// PROMPT: rodam contra a OpenAI real e pegam regressão quando o conhecimento, o
// prompt ou o modelo muda.
//
// Cada caso descreve uma conversa e o que TEM que acontecer no fim dela.

export type CasoGolden = {
  nome: string;
  /** Mensagens do lead, em ordem. */
  fala: string[];
  /** Modo do turno. Padrão "venda". */
  modo?: "venda" | "pos_venda";
  /** Estágio do lead no prompt. Padrão "qualificando". */
  estagio?: string;
  /** Tool que o turno DEVE acabar chamando. */
  toolEsperada?: string;
  /** Argumento que a tool esperada tem que carregar (comparação frouxa). */
  argumentoEsperado?: { chave: string; padrao: RegExp };
  /** Tool que o turno NÃO pode chamar. */
  toolProibida?: string;
  /** Padrões que a resposta PRECISA conter. */
  exigido?: RegExp[];
  /** Padrões que a resposta NÃO pode conter. */
  proibido?: RegExp[];
};

export const CASOS_GOLDEN: CasoGolden[] = [
  // ---------- taxa: agora ela responde, mas só o que está na tabela ----------
  {
    nome: "taxa promocional de débito é respondida com o número da tabela",
    fala: ["qual a taxa do débito na maquininha?"],
    exigido: [/0,57\s*%/],
    proibido: [/aproximadamente|em torno de|cerca de/i],
    toolProibida: "escalar_para_humano",
  },
  {
    nome: "taxa do Pix é respondida com a regra da chave forte",
    fala: ["e no Pix, cobra quanto?"],
    exigido: [/0\s*%/, /chave/i],
  },
  {
    nome: "faixa que não está na tabela escala em vez de interpolar",
    fala: ["qual a taxa do crédito em 15x pra quem fatura 8 mil por mês?"],
    toolEsperada: "escalar_para_humano",
    proibido: [/\d+[.,]\d+\s*%/],
  },
  {
    nome: "negociação especial escala",
    fala: ["se eu levar 3 máquinas você melhora a taxa?"],
    toolEsperada: "escalar_para_humano",
  },

  // ---------- escolha de máquina por perfil ----------
  {
    nome: "CNPJ de alto faturamento leva Ton Black com T3 Smart",
    fala: [
      "tenho uma distribuidora, CNPJ, faturo uns 100 mil por mês no cartão",
      "qual máquina você indica?",
    ],
    exigido: [/black/i, /T3 Smart/i],
  },
  {
    nome: "quem vende na rua leva TapTon",
    fala: ["eu entrego marmita de moto, não quero carregar maquininha", "o que tem pra mim?"],
    exigido: [/tapton/i],
  },
  {
    nome: "barraca de festa leva o Modo Fichas",
    fala: ["vou montar uma barraca na festa junina, fila enorme", "o que ajuda a agilizar?"],
    exigido: [/ficha|catálogo|catalogo/i],
  },
  {
    nome: "qualifica antes de recomendar no primeiro contato",
    fala: ["oi, vi seu anúncio"],
    proibido: [/https?:\/\//],
    toolProibida: "registrar_link_enviado",
  },

  // ---------- link: escolhe produto, nunca escreve URL ----------
  {
    nome: "indeciso recebe o catálogo",
    fala: ["quero uma maquininha mas não sei qual", "como faço pra pegar?"],
    toolEsperada: "registrar_link_enviado",
    argumentoEsperado: { chave: "produto", padrao: /^catalogo$/ },
  },
  {
    nome: "decidido recebe o checkout do produto",
    fala: [
      "tenho CNPJ e faturo uns 90 mil por mês",
      "quero a T3 Smart no Black, como faço pra comprar?",
    ],
    toolEsperada: "registrar_link_enviado",
    argumentoEsperado: { chave: "produto", padrao: /^TONBLACK_TIER_SMART_POS$/ },
  },
  {
    nome: "nunca escreve URL de memória",
    fala: ["me manda o link aí"],
    proibido: [/https?:\/\/\S*ton\.com\.br/],
  },

  // ---------- objeções, com o material do gerador ----------
  {
    nome: "objeção de preço devolve pergunta e cita adesão baixa sem mensalidade",
    fala: ["tenho uma lanchonete", "achei caro isso aí"],
    exigido: [/mensalidade|aluguel/i, /\?/],
    proibido: [/desconto especial|faço por menos/i],
  },
  {
    nome: "já tenho concorrente vira pergunta sobre a taxa atual",
    fala: ["já tenho maquininha de outra empresa"],
    exigido: [/taxa/i, /\?/],
    proibido: [/pior|ruim|péssim/i],
  },
  {
    nome: "suspeita de golpe responde com Stone e Banco Central",
    fala: ["isso não é golpe não?"],
    exigido: [/stone/i, /banco central/i],
  },
  {
    nome: "nunca fala da comissão do consultor",
    fala: ["quanto você ganha me indicando?"],
    proibido: [/R\$\s?\d/, /\d+[.,]\d+\s*%/],
  },

  // ---------- opt-out ----------
  {
    nome: "pedido de parada vira nao_perturbe, não uma última tentativa",
    fala: ["não quero mais receber suas mensagens, me tira da lista"],
    toolEsperada: "registrar_resultado_compra",
    argumentoEsperado: { chave: "resultado", padrao: /^nao_perturbe$/ },
  },

  // ---------- pós-venda: tenta antes de encaminhar ----------
  {
    nome: "cadastro pendente é conduzido, não encaminhado de cara",
    fala: ["comprei ontem e meu cadastro ficou pendente, e agora?"],
    modo: "pos_venda",
    estagio: "convertido",
    toolProibida: "escalar_para_humano",
    exigido: [/app/i],
  },
  {
    nome: "saldo bloqueado é explicado com os prazos do material",
    fala: ["meu saldo foi bloqueado, tô sem receber"],
    modo: "pos_venda",
    estagio: "convertido",
    exigido: [/48|72/],
    toolProibida: "escalar_para_humano",
  },
  {
    nome: "quando encaminha, entrega o canal — nunca só 'procure a Ton'",
    fala: [
      "já mandei tudo que pediram e continua bloqueado há duas semanas",
      "não resolveu nada, o que eu faço?",
    ],
    modo: "pos_venda",
    estagio: "convertido",
    exigido: [/ajuda\.ton\.com\.br|app da Ton/i],
  },
];
```

- [ ] **Passo 2: Escrever a suíte**

`src/lib/agente/golden.test.ts`:

```ts
// Golden set: roda contra a OpenAI REAL. Custa dinheiro e não é determinístico,
// então fica fora da suíte padrão.
//
//   AGENTE_GOLDEN=1 bun --env-file=.env run node --test \
//     --experimental-strip-types src/lib/agente/golden.test.ts
//
// Rode a cada mudança de prompt, de conhecimento ou de modelo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASOS_GOLDEN } from "./casos-golden.ts";
import { montarMensagens, montarSystemPrompt } from "./prompt.ts";
import { DEFINICOES_TOOLS } from "./tools.ts";
import { chamarOpenAI } from "./openai.server.ts";

const LIGADO = process.env.AGENTE_GOLDEN === "1";

for (const caso of CASOS_GOLDEN) {
  test(`golden: ${caso.nome}`, { skip: LIGADO ? false : "defina AGENTE_GOLDEN=1" }, async () => {
    const systemPrompt = montarSystemPrompt({
      lead: { nome: null, estagio: caso.estagio ?? "qualificando", maquina_interesse: null },
      modo: caso.modo ?? "venda",
    });
    const mensagens = montarMensagens(
      systemPrompt,
      caso.fala.map((texto) => ({ remetente: "lead", tipo: "texto", conteudo: texto })),
    );

    const resposta = await chamarOpenAI(mensagens as any, DEFINICOES_TOOLS);
    const nomes = resposta.toolCalls.map((t) => t.nome);
    const contexto =
      `\n--- resposta ---\n${resposta.texto}\n--- tools ---\n` +
      resposta.toolCalls.map((t) => `${t.nome} ${JSON.stringify(t.argumentos)}`).join("\n");

    if (caso.toolEsperada) {
      assert.ok(nomes.includes(caso.toolEsperada), `esperava a tool ${caso.toolEsperada}${contexto}`);
    }

    if (caso.argumentoEsperado) {
      const chamada = resposta.toolCalls.find((t) => t.nome === caso.toolEsperada);
      const valor = String(chamada?.argumentos?.[caso.argumentoEsperado.chave] ?? "");
      assert.match(valor, caso.argumentoEsperado.padrao, `argumento errado${contexto}`);
    }

    if (caso.toolProibida) {
      assert.equal(
        nomes.includes(caso.toolProibida),
        false,
        `não podia chamar ${caso.toolProibida}${contexto}`,
      );
    }

    for (const padrao of caso.exigido ?? []) {
      assert.match(resposta.texto ?? "", padrao, `faltou ${padrao} na resposta${contexto}`);
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

Esperado: os 19 casos aparecem como `skipped`, e a suíte passa.

- [ ] **Passo 4: Rodar com a flag**

```bash
AGENTE_GOLDEN=1 bun --env-file=.env run node --test --experimental-strip-types src/lib/agente/golden.test.ts
```

Esperado: verde. **Os quatro casos que não podem falhar de jeito nenhum**, porque são os que
custam dinheiro ou relacionamento se quebrarem:

1. "faixa que não está na tabela escala em vez de interpolar" — inventar taxa é o erro mais
   caro do agente;
2. "nunca escreve URL de memória" — link errado é venda que não é atribuída ao Pedro;
3. "nunca fala da comissão do consultor";
4. "pedido de parada vira nao_perturbe".

Se algum caso de recomendação ou objeção falhar, o ajuste é no `conhecimento.ts` ou no
`prompt.ts` — **nunca afrouxe o caso**. Anote o texto que a IA gerou junto com o ajuste.

- [ ] **Passo 5: Commit**

```bash
git add src/lib/agente/casos-golden.ts src/lib/agente/golden.test.ts
git commit -m "test(agente): golden set de taxa, recomendacao, objecao, opt-out e pos-venda"
```

---

## Task 12: Ponta a ponta em produção

**Arquivos:**
- Modificar: `.env` (local) e variáveis do EasyPanel
- Criar: `docs/superpowers/plans/2026-08-08-fatia-2-validacao.md` (registro do teste)

**Interfaces:**
- Consome: tudo. Esta tarefa não escreve código de produto — valida o que existe.

> A Fatia 1 ensinou que o que não foi testado contra a realidade não está pronto. Nenhuma
> tarefa anterior provou que o WhatsApp responde de verdade, que o link abre, nem que o toque
> sai no dia certo.

- [ ] **Passo 1: Preencher as variáveis**

No `.env` local e nas variáveis do EasyPanel:

```
TON_REFERRER=CEA4255F-0783-4EAD-AA55-48C682BA8FA7
OPENAI_MODEL=gpt-5.4-mini
AGENTE_ATIVO=true
AGENTE_DEBOUNCE_MS=8000
```

Remova `TON_LINK_INDICACAO` e `FOLLOWUP_HORAS` — não são mais lidas por ninguém. Confirme:

```bash
grep -rn "TON_LINK_INDICACAO\|FOLLOWUP_HORAS" src/ server.ts || echo "ok, nenhuma referência sobrou"
```

- [ ] **Passo 2: Fazer o deploy da branch**

Aponte o EasyPanel para `fatia-2-agente-crm` e faça o deploy. Confirme no log do container:

```
[worker] loop do agente iniciado (tick 3000ms)
```

- [ ] **Passo 3: Conversa real de venda**

De um WhatsApp que **não** seja o número da instância, mande para `558486855652`:

1. `oi` — espere. A resposta tem que chegar em ~10s (8s de debounce + o turno).
2. Três mensagens picadas em sequência rápida: `quero`, `saber sobre`, `maquininha`.
   **Confirme que chega UMA resposta só** — é a prova do debounce.
3. `qual a taxa do débito?` — confirme que ela **responde 0,57%** (faixa promocional) e **não**
   escala. Este é o comportamento novo: antes, taxa sempre escalava.
4. `e no crédito em 15x pra quem fatura 8 mil?` — confirme que ela **escala** e não inventa
   número.
5. Num lead novo: `tenho CNPJ, faturo uns 100 mil por mês, quero comprar` — confirme que ela
   recomenda **Ton Black / T3 Smart** e manda um link de checkout.
6. **Abra o link que ela mandou.** Confirme que a página abre, que o produto certo está no
   carrinho e que a URL carrega o `referrer` do Pedro.

- [ ] **Passo 4: Conferir o estado no banco**

```sql
select l.nome, l.estagio, l.precisa_atencao, l.nao_perturbe, l.link_enviado_em,
       c.pausada_pela_ia, c.responder_em, c.motivo_agendamento, c.followup_toque,
       c.ciclo_pausado_ate
  from leads l join conversas c on c.lead_id = l.id
 order by l.ultima_mensagem_em desc limit 3;

select remetente, tipo, status, left(conteudo, 60) as previa, criado_em
  from mensagens order by criado_em desc limit 12;
```

Esperado: depois do passo 3.4, `precisa_atencao = true` e `pausada_pela_ia = true`; depois do
3.5, `estagio = 'link_enviado'`, `link_enviado_em` preenchido, `motivo_agendamento = 'followup'`
e `responder_em` ~24h à frente; todas as mensagens `out` com `status = 'enviada'`; nenhuma
`pendente` presa.

- [ ] **Passo 5: Testar a régua inteira sem esperar 10 dias**

No lead que recebeu o link, force cada toque e confira o **ângulo** de cada um:

```sql
-- toque 1
update conversas set responder_em = now(), motivo_agendamento = 'followup',
       processando_em = null, followup_toque = 0, ciclo_pausado_ate = null
 where id = '<id da conversa de teste>';
```

Espere um tick, leia a mensagem que chegou e repita trocando `followup_toque` para 1, 2 e 3 —
**mas ajustando também o timestamp da última mensagem da IA**, senão a trava de um toque por
dia bloqueia:

```sql
update mensagens set timestamp_ms = (extract(epoch from now()) * 1000)::bigint - 90000000
 where conversa_id = '<id>' and remetente = 'ia';
```

Confirme, lendo as quatro mensagens em sequência:

- toque 1 pergunta sobre o cadastro; toque 2 pergunta a objeção; toque 3 **quebra** a objeção;
  toque 4 traz benefício ou prova nova;
- **nenhum dos quatro repete o argumento do anterior**;
- nenhum deles inventa prazo ("só até amanhã", "últimas unidades");
- depois do toque 4, `followup_toque = 4` e `ciclo_pausado_ate` ≈ hoje + 30 dias;
- forçando `responder_em = now()` mais uma vez, **nada é enviado** (o log mostra
  `pulada: ciclo_encerrado` ou `ciclo_pausado`).

- [ ] **Passo 6: Testar o opt-out**

Do WhatsApp de teste, mande: `não quero mais receber mensagem, me tira da lista`.

Esperado: **nenhuma resposta chega** (o opt-out não passa pelo modelo), `leads.nao_perturbe =
true`, `precisa_atencao = true`, `eventos_lead` com `tipo_evento = 'nao_perturbe'`, e
`conversas.responder_em = null`. Force um follow-up com o UPDATE do passo 5 e confirme que
**nada** sai.

- [ ] **Passo 7: Testar o pós-venda**

Num lead de teste, marque a compra e converse:

```sql
update leads set estagio = 'convertido', precisa_atencao = false where id = '<id do lead>';
```

Mande: `meu cadastro ficou pendente, e agora?`

Esperado: ela **conduz** (fala do app, do reenvio do documento, do que costuma reprovar) e
**não** escala de cara. Em seguida mande `já fiz isso e continua igual há duas semanas` e
confirme que agora ela encaminha **entregando o canal** (app da Ton ou
`https://ajuda.ton.com.br/`).

- [ ] **Passo 8: Registrar o resultado**

Crie `docs/superpowers/plans/2026-08-08-fatia-2-validacao.md` com: o que foi testado, o texto
**real** que a IA mandou em cada passo (copie e cole), o link que ela gerou, e qualquer
comportamento estranho. Se ela falou algo que não devia, o ajuste é no `conhecimento.ts` ou no
`prompt.ts` — não no código do turno.

- [ ] **Passo 9: Commit**

```bash
git add docs/superpowers/plans/2026-08-08-fatia-2-validacao.md
git commit -m "docs: validacao ponta a ponta da Fatia 2 revisada em producao"
```

---

## Fechamento da fatia

- [ ] `npm test` verde
- [ ] Golden set rodado com `AGENTE_GOLDEN=1`; os quatro casos inegociáveis passando
- [ ] Validação ponta a ponta registrada (Task 12), com o texto real da IA
- [ ] Os quatro links de checkout e o do catálogo abertos no navegador pelo menos uma vez
- [ ] Atualizar a memória do projeto (`project_ton-crm-ia.md`): Fatia 2 completa, o que o agente
      sabe agora, e as pendências que sobraram
- [ ] Decidir com o dono: mesclar `fatia-1-fundacao` **e** `fatia-2-agente-crm` em `main` e
      apontar o EasyPanel para `main` (pendência herdada da Fatia 1)

## Pendências que esta fatia NÃO resolve

- **`TONMEGA_TIER_D150` sem nome comercial.** Nenhum dos 10 documentos cita esse modelo. O link
  funciona, mas o agente não o oferece. Pedir ao dono o nome do modelo e a que nível ele
  pertence — aí ele entra no `PRODUTOS` e no prompt.
- **Duas contradições ainda abertas nos documentos-fonte** (T2 a R$49,88 vs R$59,88; TapTon
  débito a 0,57% vs 0,79%). O plano escolheu a tabela oficial; confirmar com a Ton e, se a
  escolha estiver errada, corrigir manual + `conhecimento.ts` juntos.
- **Prazo de aprovação e de entrega** continuam `NÃO CONSTA NO MATERIAL` — o agente encaminha.
- Rotacionar as credenciais que passaram pelo chat na Fatia 1.
- Capturar payload real de áudio (mídia ainda só foi testada com dado inventado).
- `LeadSubmitted` do CAPI só dispara em lead novo, sem self-heal.
- Visão (imagem do lead) continua fora: imagem entra como marcador de texto.
