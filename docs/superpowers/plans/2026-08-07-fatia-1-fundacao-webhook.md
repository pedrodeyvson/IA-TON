# Fatia 1 — Fundação + Webhook UAZAPI — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar tarefa a tarefa. Os passos usam checkbox (`- [ ]`) para rastreio.

**Objetivo:** Fazer mensagens do WhatsApp chegarem pela UAZAPI e virarem leads e mensagens no banco, com idempotência, telefone brasileiro normalizado, resolução de `@lid` e atribuição de anúncio capturada.

**Arquitetura:** TanStack Start (rota de API para o webhook) + Supabase (Postgres com RLS) + UAZAPI. A lógica de parsing fica em módulos puros testáveis, sem dependência de alias ou de rede; a orquestração fica em `.server.ts`. O webhook persiste o payload cru antes de processar e devolve 500 em erro para o provider reentregar.

**Tech Stack:** Bun, TanStack Start `^1.168`, React 19, Vite 8, TypeScript 5.9, `@supabase/supabase-js` ^2.108, Tailwind v4, Zod v3, test runner nativo do Node.

## Constraints Globais

Estes valem para **todas** as tarefas:

- **Runtime é Bun.** Instalar com `bun add`, rodar com `bun run`.
- **Zod é v3** (`^3.24.2`), não v4. A API `z.object({}).parse(d)` é a usada.
- **Convenção de módulos do TanStack Start:** `*.functions.ts` vai para o bundle do cliente (só o corpo do handler é removido) — **nada server-only no topo do arquivo**. `*.server.ts` é server-only e é sempre importado com `await import()` de **dentro** de um handler. Violar isso quebra em runtime com `ReferenceError`.
- **Testes:** `node --test --experimental-strip-types "src/**/*.test.ts"`. O loader ESM nativo **não resolve o alias `@/`** e **exige extensão `.ts` explícita** nos imports. Todo módulo que tem teste importa somente por caminho relativo com `.ts`.
- **Migrations** são aplicadas via MCP `mcp__plugin_supabase_supabase__apply_migration`. Migration aplicada nunca é editada — correção sempre em migration nova.
- **Nomes de coluna são neutros quanto ao provider:** `provider_message_id`, nunca `uazapi_message_id` ou `evolution_message_id`.
- **Objetos de banco vivem em `public`**, no schema padrão — o projeto Supabase é dedicado a este sistema, então não há com o que colidir. Funções usam `set search_path = public`.
- **Campos de `contextInfo` são não documentados** e podem sumir: todo acesso usa optional chaining, toda coluna é nullable.
- **Grafia crítica:** `sourceID` e `sourceURL` — **maiúsculas** no final. Não é `sourceId`/`sourceUrl`.
- Toda mensagem de erro voltada ao usuário é em português.

**Projeto Supabase (decidido em 07/08/2026):** `fqnvwrhetpnwsxqfwxnf` (nome "TON CRM IA", região sa-east-1, organização `vyyuegptcmiqfywkmxly`). Dedicado a este sistema — nenhum outro projeto compartilha este banco.

> Histórico: cogitou-se reutilizar o projeto `dzpawynpyhqytmwihyrd` ("IA_CRM"), mas ele hospeda outro sistema em produção cujo `public` tem 36 tabelas vivas — incluindo uma `webhook_events` que colidiria com a nossa. Optou-se por um banco dedicado.

**Hospedagem:** Vercel, projeto `ebx/ia-ton` → `ia-ton.vercel.app`, ligado ao repo `github.com/pedrodeyvson/IA-TON`, deploy automático da branch `main`.

---

### Task 1: Bootstrap do projeto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `bunfig.toml`, `.gitignore`, `.env.example`
- Create: `src/lib/sanidade.ts`, `src/lib/sanidade.test.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: `bun run test` executando o runner nativo; alias `@/*` → `./src/*` para código de aplicação

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/sanidade.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { versaoDoProjeto } from "./sanidade.ts";

test("expõe a versão do projeto", () => {
  assert.equal(versaoDoProjeto(), "1.0.0");
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './sanidade.ts'`

- [ ] **Step 3: Criar os arquivos de configuração**

`package.json`:
```json
{
  "name": "ton-crm-ia",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "test": "node --test --experimental-strip-types \"src/**/*.test.ts\"",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.108.2",
    "@tanstack/react-query": "^5.101.1",
    "@tanstack/react-router": "^1.170.16",
    "@tanstack/react-start": "^1.168.26",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@tanstack/router-plugin": "^1.168.18",
    "@types/node": "^22.10.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "typescript": "^5.9.3",
    "vite": "^8.0.16"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": false,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

`bunfig.toml`:
```toml
[install]
# Ignora versões publicadas há menos de 24h — guarda contra supply-chain.
minimumReleaseAge = 86400
```

`.gitignore`:
```
node_modules
.output
.nitro
.tanstack
dist
.env
.env.local
*.log
```

`.env.example`:
```
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
PUBLIC_SITE_URL=
UAZAPI_BASE_URL=
UAZAPI_ADMIN_TOKEN=
UAZAPI_TOKEN=
UAZAPI_WEBHOOK_SECRET=
GROQ_API_KEY=
ANTHROPIC_API_KEY=
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsConfigPaths(), tanstackStart(), react()],
});
```

`src/lib/sanidade.ts`:
```ts
export function versaoDoProjeto(): string {
  return "1.0.0";
}
```

- [ ] **Step 4: Instalar dependências e rodar o teste**

Rodar: `bun add @vitejs/plugin-react vite-tsconfig-paths --dev && bun install && bun run test`
Esperado: PASSA — 1 teste.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: bootstrap do projeto com runner de teste nativo"
```

---

### Task 2: Normalização de telefone brasileiro

Leads chegam com o telefone em formatos diferentes (com e sem o 9º dígito, com e sem `55`). Sem uma chave canônica, o mesmo lead vira dois.

**Files:**
- Create: `src/lib/telefone.ts`
- Test: `src/lib/telefone.test.ts`

**Interfaces:**
- Produces: `normalizarTelefoneBr(t: string | null | undefined): string` — chave canônica (remove o 9º dígito); `normalizarCandidato(v: string | null | undefined): string` — completa o `55` e rejeita IDs longos; `apenasDigitos(v): string`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/telefone.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarTelefoneBr, normalizarCandidato } from "./telefone.ts";

test("normalizarTelefoneBr remove o 9º dígito de celular com DDI", () => {
  assert.equal(normalizarTelefoneBr("5511987654321"), "551187654321");
});

test("normalizarTelefoneBr descarta máscara e mantém número sem 9", () => {
  assert.equal(normalizarTelefoneBr("+55 (11) 8765-4321"), "551187654321");
});

test("normalizarTelefoneBr devolve vazio para entrada nula ou sem dígito", () => {
  assert.equal(normalizarTelefoneBr(null), "");
  assert.equal(normalizarTelefoneBr("abc"), "");
});

test("normalizarTelefoneBr não mexe em número que já vem sem o 9", () => {
  assert.equal(normalizarTelefoneBr("551187654321"), "551187654321");
});

test("normalizarCandidato completa o DDI 55 quando vem só DDD + número", () => {
  assert.equal(normalizarCandidato("11987654321"), "5511987654321");
  assert.equal(normalizarCandidato("1187654321"), "551187654321");
});

test("normalizarCandidato aceita número que já tem DDI", () => {
  assert.equal(normalizarCandidato("5511987654321"), "5511987654321");
});

test("normalizarCandidato rejeita identificador longo (LID)", () => {
  assert.equal(normalizarCandidato("264081359843075"), "");
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './telefone.ts'`

- [ ] **Step 3: Implementar**

`src/lib/telefone.ts`:
```ts
export function apenasDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D+/g, "");
}

/**
 * Chave canônica de comparação: remove o 9º dígito dos celulares brasileiros.
 * O WhatsApp devolve o mesmo contato ora com ele, ora sem — comparar pelo bruto
 * duplica o lead.
 */
export function normalizarTelefoneBr(telefone: string | null | undefined): string {
  const d = apenasDigitos(telefone);
  if (!d) return "";
  if (d.length === 13 && d.startsWith("55") && d[4] === "9") {
    return d.slice(0, 4) + d.slice(5);
  }
  return d;
}

/**
 * Aceita um candidato a telefone vindo do payload e devolve o número completo
 * com DDI, ou vazio se não for um telefone brasileiro plausível. Serve para
 * filtrar identificadores internos do WhatsApp (LID), que são bem mais longos.
 */
export function normalizarCandidato(valor: string | null | undefined): string {
  const d = apenasDigitos(valor);
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return "";
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Rodar: `bun run test`
Esperado: PASSA — 7 testes novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/telefone.ts src/lib/telefone.test.ts
git commit -m "feat: normalização de telefone brasileiro"
```

---

### Task 3: Parser do webhook UAZAPI

A UAZAPI manda dois formatos diferentes para a mesma coisa: histórico em lote (`messages` plural, com `EventType: "history"`) e mensagem ao vivo (`message` singular, **sem** o campo `event`). O parser reconcilia os dois numa forma única.

**Files:**
- Create: `src/lib/uazapi/parse.ts`
- Create: `src/lib/uazapi/fixtures/mensagem-texto.json`, `src/lib/uazapi/fixtures/mensagem-anuncio.json`
- Test: `src/lib/uazapi/parse.test.ts`

**Interfaces:**
- Produces: `parseWebhookUazapi(body: unknown): EventoUazapi` onde `EventoUazapi = { evento: string; instancia: string; itens: any[] }`

- [ ] **Step 1: Escrever os fixtures**

`src/lib/uazapi/fixtures/mensagem-texto.json`:
```json
{
  "EventType": "messages",
  "instanceName": "ton-consultor",
  "message": {
    "messageid": "3EB0C767D26A8B4F1A2B",
    "fromMe": false,
    "messageTimestamp": 1754582400,
    "key": { "remoteJid": "5511987654321@s.whatsapp.net", "id": "3EB0C767D26A8B4F1A2B" },
    "content": { "conversation": "Oi, queria saber sobre a maquininha" }
  }
}
```

`src/lib/uazapi/fixtures/mensagem-anuncio.json`:
```json
{
  "EventType": "messages",
  "instanceName": "ton-consultor",
  "message": {
    "messageid": "3EB0AA11BB22CC33DD44",
    "fromMe": false,
    "messageTimestamp": 1754582500,
    "key": { "remoteJid": "5521999887766@s.whatsapp.net", "id": "3EB0AA11BB22CC33DD44" },
    "content": {
      "conversation": "Vi o anúncio, quero saber mais",
      "contextInfo": {
        "conversionSource": "FB_Ads",
        "entryPointConversionSource": "ctwa_ad",
        "entryPointConversionApp": "facebook",
        "externalAdReply": {
          "title": "Maquininha Ton a partir de R$ 12x",
          "body": "Peça a sua hoje",
          "sourceType": "ad",
          "sourceApp": "facebook",
          "sourceID": "120226305854810726",
          "sourceURL": "https://fb.me/3cr4Wqqkv"
        }
      }
    }
  }
}
```

- [ ] **Step 2: Escrever o teste que falha**

`src/lib/uazapi/parse.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWebhookUazapi } from "./parse.ts";

function fixture(nome: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), "utf8"));
}

test("normaliza mensagem ao vivo (message singular, sem campo event)", () => {
  const r = parseWebhookUazapi(fixture("mensagem-texto"));
  assert.equal(r.evento, "messages");
  assert.equal(r.instancia, "ton-consultor");
  assert.equal(r.itens.length, 1);
  assert.equal(r.itens[0].messageid, "3EB0C767D26A8B4F1A2B");
});

test("normaliza lote de histórico (messages plural)", () => {
  const r = parseWebhookUazapi({
    event: "messages",
    EventType: "history",
    instance: "ton-consultor",
    messages: [{ messageid: "a" }, { messageid: "b" }],
  });
  assert.equal(r.evento, "history");
  assert.equal(r.itens.length, 2);
});

test("reconhece evento de conexão sem itens", () => {
  const r = parseWebhookUazapi({ event: "connection", instance: "ton-consultor" });
  assert.equal(r.evento, "connection");
  assert.deepEqual(r.itens, []);
});

test("aceita body vazio sem lançar", () => {
  const r = parseWebhookUazapi({});
  assert.equal(r.instancia, "");
  assert.deepEqual(r.itens, []);
});

test("aceita instanceName ou instance", () => {
  assert.equal(parseWebhookUazapi({ instance: "x" }).instancia, "x");
  assert.equal(parseWebhookUazapi({ instanceName: "y" }).instancia, "y");
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './parse.ts'`

- [ ] **Step 4: Implementar**

`src/lib/uazapi/parse.ts`:
```ts
export type EventoUazapi = {
  evento: string;
  instancia: string;
  itens: any[];
};

/**
 * A UAZAPI usa duas formas para mensagens:
 *   1) lote de histórico: { event: "messages", EventType: "history", messages: [...] }
 *   2) mensagem ao vivo:  { EventType: "messages", message: {...} }  ← singular, SEM `event`
 * Esta função reduz as duas a uma forma só.
 */
export function parseWebhookUazapi(body: any): EventoUazapi {
  const categoria: string = body?.event ?? "";
  const tipo: string = body?.EventType ?? categoria;
  const instancia: string = body?.instanceName ?? body?.instance ?? "";

  const bruto = body?.messages ?? body?.message ?? body?.data;
  const itens = Array.isArray(bruto) ? bruto : bruto != null ? [bruto] : [];

  let evento: string;
  if (tipo === "history") evento = "history";
  else if (itens.length > 0 && (tipo === "messages" || categoria === "messages")) evento = "messages";
  else evento = categoria || tipo;

  return { evento, instancia, itens };
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Rodar: `bun run test`
Esperado: PASSA — 5 testes novos.

- [ ] **Step 6: Commit**

```bash
git add src/lib/uazapi/
git commit -m "feat: parser do webhook UAZAPI com fixtures"
```

---

### Task 4: Resolução de identidade e `@lid`

Quando o contato tem identificador de privacidade, o `remoteJid` vem como `...@lid` e **não contém o telefone real**. É preciso varrer o payload atrás de um candidato válido; sem isso o lead entra sem telefone.

**Files:**
- Create: `src/lib/uazapi/identidade.ts`
- Test: `src/lib/uazapi/identidade.test.ts`

**Interfaces:**
- Consumes: `normalizarCandidato` de `../telefone.ts`
- Produces: `ehLid(jid): boolean`; `extrairTelefoneDeJid(jid): string`; `resolverTelefoneReal(dados: any, key: any): { telefone: string; jid: string | null }`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/uazapi/identidade.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehLid, extrairTelefoneDeJid, resolverTelefoneReal } from "./identidade.ts";

test("ehLid detecta identificador de privacidade", () => {
  assert.equal(ehLid("264081359843075@lid"), true);
  assert.equal(ehLid("5511987654321@s.whatsapp.net"), false);
  assert.equal(ehLid(null), false);
});

test("extrairTelefoneDeJid pega o número antes do @", () => {
  assert.equal(extrairTelefoneDeJid("5511987654321@s.whatsapp.net"), "5511987654321");
  assert.equal(extrairTelefoneDeJid(""), "");
});

test("resolverTelefoneReal usa o remoteJid quando ele já é um telefone", () => {
  const r = resolverTelefoneReal({}, { remoteJid: "5511987654321@s.whatsapp.net" });
  assert.equal(r.telefone, "5511987654321");
  assert.equal(r.jid, "5511987654321@s.whatsapp.net");
});

test("resolverTelefoneReal ignora @lid e acha o telefone em senderPn", () => {
  const r = resolverTelefoneReal({}, {
    remoteJid: "264081359843075@lid",
    senderPn: "5521999887766@s.whatsapp.net",
  });
  assert.equal(r.telefone, "5521999887766");
});

test("resolverTelefoneReal encontra telefone aninhado no payload", () => {
  const r = resolverTelefoneReal(
    { chat: { participante: { id: "5531988776655@s.whatsapp.net" } } },
    { remoteJid: "264081359843075@lid" },
  );
  assert.equal(r.telefone, "5531988776655");
});

test("resolverTelefoneReal devolve vazio quando só há LID", () => {
  const r = resolverTelefoneReal({}, { remoteJid: "264081359843075@lid" });
  assert.equal(r.telefone, "");
  assert.equal(r.jid, null);
});

test("resolverTelefoneReal não estoura em payload circular ou profundo", () => {
  const profundo: any = { a: { b: { c: { d: { e: { f: { g: "5511987654321@s.whatsapp.net" } } } } } } };
  assert.doesNotThrow(() => resolverTelefoneReal(profundo, {}));
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './identidade.ts'`

- [ ] **Step 3: Implementar**

`src/lib/uazapi/identidade.ts`:
```ts
import { normalizarCandidato } from "../telefone.ts";

const PROFUNDIDADE_MAXIMA = 5;

const CHAVES_DE_IDENTIDADE = new Set([
  "senderpn", "participantpn", "sender", "participant",
  "remotejid", "remotejidalt", "participantalt", "previousremotejid",
]);

export function ehLid(jid: string | null | undefined): boolean {
  return !!jid && jid.includes("@lid");
}

export function extrairTelefoneDeJid(jid: string | null | undefined): string {
  if (!jid) return "";
  const bruto = jid.split("@")[0] ?? "";
  return normalizarCandidato(bruto);
}

function ehChaveDeIdentidade(chave: string): boolean {
  return CHAVES_DE_IDENTIDADE.has(chave.toLowerCase());
}

/**
 * Varre o payload atrás de strings que pareçam identidade de contato,
 * ignorando LIDs. Limitada em profundidade para não estourar em payload grande.
 */
export function coletarCandidatos(entrada: any, saida: string[] = [], profundidade = 0): string[] {
  if (!entrada || typeof entrada !== "object" || profundidade > PROFUNDIDADE_MAXIMA) return saida;
  for (const [chave, valor] of Object.entries(entrada)) {
    if (typeof valor === "string") {
      if ((valor.includes("@s.whatsapp.net") || ehChaveDeIdentidade(chave)) && !ehLid(valor)) {
        saida.push(valor);
      }
    } else if (valor && typeof valor === "object") {
      coletarCandidatos(valor, saida, profundidade + 1);
    }
  }
  return saida;
}

export function resolverTelefoneReal(
  dados: any,
  key: any,
): { telefone: string; jid: string | null } {
  const candidatos = [
    key?.remoteJid, key?.remoteJidAlt, key?.participantAlt, key?.senderPn,
    key?.participantPn, key?.previousRemoteJid,
    dados?.senderPn, dados?.participantPn, dados?.sender, dados?.participant,
    ...coletarCandidatos(dados),
  ];

  for (const candidato of candidatos) {
    if (!candidato || typeof candidato !== "string" || ehLid(candidato)) continue;
    const telefone = candidato.includes("@")
      ? extrairTelefoneDeJid(candidato)
      : normalizarCandidato(candidato);
    if (telefone) {
      return { telefone, jid: candidato.includes("@") ? candidato : `${telefone}@s.whatsapp.net` };
    }
  }
  return { telefone: "", jid: null };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Rodar: `bun run test`
Esperado: PASSA — 7 testes novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/uazapi/identidade.ts src/lib/uazapi/identidade.test.ts
git commit -m "feat: resolução de telefone real com tratamento de @lid"
```

---

### Task 5: Extração da atribuição de anúncio

**Files:**
- Create: `src/lib/uazapi/anuncio.ts`
- Test: `src/lib/uazapi/anuncio.test.ts`

**Interfaces:**
- Produces: `extrairAtribuicaoAnuncio(conteudo: any): AtribuicaoAnuncio | null` onde
  `AtribuicaoAnuncio = { adSourceId, adSourceUrl, adTitle, adSourceApp, adConversionSource, ctwaClid, referralRaw }` (todos `string | null` menos `referralRaw`, que é o objeto original)

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/uazapi/anuncio.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extrairAtribuicaoAnuncio } from "./anuncio.ts";

function fixture(nome: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${nome}.json`, import.meta.url), "utf8"));
}

test("devolve null quando a mensagem não veio de anúncio", () => {
  const conteudo = fixture("mensagem-texto").message.content;
  assert.equal(extrairAtribuicaoAnuncio(conteudo), null);
});

test("extrai os campos do externalAdReply", () => {
  const conteudo = fixture("mensagem-anuncio").message.content;
  const a = extrairAtribuicaoAnuncio(conteudo);
  assert.ok(a);
  assert.equal(a.adSourceId, "120226305854810726");
  assert.equal(a.adSourceUrl, "https://fb.me/3cr4Wqqkv");
  assert.equal(a.adTitle, "Maquininha Ton a partir de R$ 12x");
  assert.equal(a.adSourceApp, "facebook");
  assert.equal(a.adConversionSource, "FB_Ads");
});

test("captura ctwa_clid quando presente (grafia ctwaClid do proto)", () => {
  const a = extrairAtribuicaoAnuncio({
    contextInfo: { externalAdReply: { sourceID: "1", ctwaClid: "ARAkLkA8rmlFeiCkt" } },
  });
  assert.equal(a?.ctwaClid, "ARAkLkA8rmlFeiCkt");
});

test("ctwa_clid ausente vira null, não quebra", () => {
  const a = extrairAtribuicaoAnuncio({ contextInfo: { externalAdReply: { sourceID: "1" } } });
  assert.equal(a?.ctwaClid, null);
});

test("preserva o contextInfo inteiro em referralRaw", () => {
  const contextInfo = { externalAdReply: { sourceID: "1" }, campoNovoDesconhecido: "x" };
  const a = extrairAtribuicaoAnuncio({ contextInfo });
  assert.deepEqual(a?.referralRaw, contextInfo);
});

test("NÃO aceita a grafia minúscula sourceId (é sourceID no proto)", () => {
  const a = extrairAtribuicaoAnuncio({ contextInfo: { externalAdReply: { sourceId: "999" } } });
  assert.equal(a?.adSourceId, null);
});

test("tolera conteudo nulo ou sem contextInfo", () => {
  assert.equal(extrairAtribuicaoAnuncio(null), null);
  assert.equal(extrairAtribuicaoAnuncio({}), null);
  assert.equal(extrairAtribuicaoAnuncio({ contextInfo: {} }), null);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './anuncio.ts'`

- [ ] **Step 3: Implementar**

`src/lib/uazapi/anuncio.ts`:
```ts
export type AtribuicaoAnuncio = {
  adSourceId: string | null;
  adSourceUrl: string | null;
  adTitle: string | null;
  adSourceApp: string | null;
  adConversionSource: string | null;
  ctwaClid: string | null;
  referralRaw: unknown;
};

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.length > 0 ? valor : null;
}

/**
 * Extrai a atribuição de anúncio do `contextInfo` que a UAZAPI repassa cru do
 * protocolo do WhatsApp. Esse repasse NÃO está na spec oficial da UAZAPI — é
 * comportamento observado. Por isso todo campo é opcional e o objeto original
 * é preservado em `referralRaw`.
 *
 * ATENÇÃO à grafia: `sourceID` e `sourceURL` são MAIÚSCULAS (naming do proto
 * whatsmeow). Baileys/Evolution usam sourceId/sourceUrl — usar a grafia errada
 * devolve undefined silenciosamente.
 */
export function extrairAtribuicaoAnuncio(conteudo: any): AtribuicaoAnuncio | null {
  const contextInfo = conteudo?.contextInfo;
  const anuncio = contextInfo?.externalAdReply;
  if (!anuncio) return null;

  return {
    adSourceId: texto(anuncio.sourceID),
    adSourceUrl: texto(anuncio.sourceURL),
    adTitle: texto(anuncio.title),
    adSourceApp: texto(anuncio.sourceApp) ?? texto(contextInfo.entryPointConversionApp),
    adConversionSource: texto(contextInfo.conversionSource) ?? texto(contextInfo.entryPointConversionSource),
    ctwaClid: texto(anuncio.ctwaClid),
    referralRaw: contextInfo,
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Rodar: `bun run test`
Esperado: PASSA — 7 testes novos.

- [ ] **Step 5: Commit**

```bash
git add src/lib/uazapi/anuncio.ts src/lib/uazapi/anuncio.test.ts
git commit -m "feat: extração de atribuição de anúncio do contextInfo"
```

---

### Task 6: Schema do banco com RLS

**Files:**
- Create: `supabase/migrations/20260807_fundacao.sql`

**Interfaces:**
- Produces: tabelas `leads`, `conversas`, `mensagens`, `webhook_events`, `eventos_lead`, `eventos_capi`; função `public.normalizar_telefone_br(text)`; helper `public.eh_dono()`

**Pré-requisito:** o projeto Supabase já existe e as chaves estão no `.env`.

- [ ] **Step 1: Escrever a migration**

`supabase/migrations/20260807_fundacao.sql`:
```sql
-- Fundação do TON-CRM-IA.
-- Uso individual: um único operador (o consultor). Não há multi-tenancy — a RLS
-- só separa "usuário autenticado" de "anônimo", e o service_role do webhook
-- passa por cima dela para poder gravar mensagens de quem ainda não é usuário.
--

-- Espelha em SQL a normalização de telefone feita em src/lib/telefone.ts.
-- IMMUTABLE porque é usada em índice.
create or replace function public.normalizar_telefone_br(p text)
returns text language plpgsql immutable set search_path = public as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  if length(d) = 13 and substring(d,1,2) = '55' and substring(d,5,1) = '9' then
    return substring(d,1,4) || substring(d,6);
  end if;
  return d;
end; $$;

create or replace function public.eh_dono()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null;
$$;

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  telefone text,
  telefone_normalizado text,
  external_id text unique,
  nome text,
  estagio text not null default 'novo'
    check (estagio in ('novo','qualificando','apresentando_solucao','contornando_objecao',
                       'link_enviado','acompanhamento','convertido','perdido')),
  origem text,
  maquina_interesse text,
  comissao_estimada numeric(10,2),
  comissao_confirmada numeric(10,2),
  precisa_atencao boolean not null default false,
  -- Atribuição de anúncio. Todos opcionais: só o lead vindo de anúncio preenche,
  -- e o formato vem de campo não documentado da UAZAPI.
  ad_source_id text,
  ad_source_url text,
  ad_title text,
  ad_source_app text,
  ad_conversion_source text,
  ctwa_clid text,
  ad_referral_raw jsonb,
  -- Desnormalização para a lista do inbox não precisar de subquery.
  ultima_mensagem_em timestamptz,
  ultima_mensagem_preview text,
  ultima_mensagem_direcao text,
  nao_lidas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index leads_telefone_normalizado_idx
  on public.leads (telefone_normalizado) where telefone_normalizado is not null;
create index leads_ad_source_id_idx
  on public.leads (ad_source_id) where ad_source_id is not null;
create index leads_estagio_idx on public.leads (estagio);

create or replace function public.leads_set_telefone_normalizado()
returns trigger language plpgsql set search_path = public as $$
begin
  new.telefone_normalizado := public.normalizar_telefone_br(new.telefone);
  new.atualizado_em := now();
  return new;
end; $$;

create trigger trg_leads_normalizar_telefone
  before insert or update on public.leads
  for each row execute function public.leads_set_telefone_normalizado();

create table public.conversas (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads(id) on delete cascade,
  pausada_pela_ia boolean not null default false,
  assumida_em timestamptz,
  criado_em timestamptz not null default now()
);

create table public.mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  provider_message_id text,
  remetente text not null check (remetente in ('lead','ia','humano')),
  direcao text not null check (direcao in ('in','out')),
  tipo text not null check (tipo in ('texto','audio','imagem','video','documento','sticker','outro')),
  conteudo text,
  transcricao text,
  transcricao_status text check (transcricao_status in ('ok','failed','pendente')),
  media_path text,
  media_mime text,
  media_filename text,
  timestamp_ms bigint not null default (extract(epoch from now()) * 1000)::bigint,
  raw jsonb,
  criado_em timestamptz not null default now()
);

-- Segunda camada de idempotência (a primeira é o pré-check no ingest).
create unique index mensagens_provider_message_id_uniq
  on public.mensagens (provider_message_id) where provider_message_id is not null;
create index mensagens_lead_ts_idx on public.mensagens (lead_id, timestamp_ms desc);

-- Mantém o preview do inbox atualizado sem subquery na listagem.
create or replace function public.mensagens_apos_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_preview text;
begin
  v_preview := case new.tipo
    when 'texto' then left(coalesce(new.conteudo, ''), 140)
    when 'audio' then '🎤 Áudio'
    when 'imagem' then '📷 Imagem'
    when 'video' then '🎬 Vídeo'
    when 'documento' then '📎 ' || coalesce(new.media_filename, 'Documento')
    else 'Mensagem'
  end;
  update public.leads
     set ultima_mensagem_em = to_timestamp(new.timestamp_ms / 1000.0),
         ultima_mensagem_preview = v_preview,
         ultima_mensagem_direcao = new.direcao,
         nao_lidas = case when new.direcao = 'in' then nao_lidas + 1 else nao_lidas end,
         atualizado_em = now()
   where id = new.lead_id;
  return new;
end; $$;

create trigger trg_mensagens_apos_insert
  after insert on public.mensagens
  for each row execute function public.mensagens_apos_insert();

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text,
  raw_body jsonb not null,
  headers jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','processed','failed','dead')),
  attempts integer not null default 0,
  last_error text,
  next_retry_at timestamptz not null default now(),
  processed_at timestamptz,
  criado_em timestamptz not null default now()
);

create index webhook_events_status_retry_idx
  on public.webhook_events (status, next_retry_at) where status in ('pending','failed');

create table public.eventos_lead (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo_evento text not null,
  detalhe jsonb,
  criado_em timestamptz not null default now()
);

create index eventos_lead_lead_idx on public.eventos_lead (lead_id, criado_em desc);

-- Criada agora, alimentada só quando a fatia do CAPI existir. A Meta NÃO
-- deduplica eventos de business messaging — a deduplicação é nossa.
create table public.eventos_capi (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  nome_evento text not null
    check (nome_evento in ('LeadSubmitted','QualifiedLead','InitiateCheckout','Purchase')),
  event_id text not null unique,
  enviado_em timestamptz,
  status_resposta text,
  criado_em timestamptz not null default now()
);

-- RLS: tudo fechado para anônimo; o operador autenticado enxerga tudo.
-- O service_role (webhook) ignora RLS por definição.
do $$
declare t text;
begin
  foreach t in array array['leads','conversas','mensagens','webhook_events','eventos_lead','eventos_capi']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.eh_dono()) with check (public.eh_dono())',
      t || '_operador', t);
  end loop;
end $$;

-- Realtime para o inbox.
alter publication supabase_realtime add table public.mensagens;
alter publication supabase_realtime add table public.leads;
alter table public.mensagens replica identity full;
alter table public.leads replica identity full;
```

- [ ] **Step 2: Aplicar a migration**

Usar a ferramenta MCP `mcp__plugin_supabase_supabase__apply_migration` com `name: "20260807_fundacao"` e o conteúdo do arquivo.

- [ ] **Step 3: Verificar que o schema subiu**

Usar `mcp__plugin_supabase_supabase__list_tables`.
Esperado: as 6 tabelas listadas, todas com RLS habilitada.

- [ ] **Step 4: Verificar a normalização no banco**

Usar `mcp__plugin_supabase_supabase__execute_sql`:
```sql
select public.normalizar_telefone_br('+55 (11) 98765-4321') as com_nove,
       public.normalizar_telefone_br('551187654321')        as sem_nove;
```
Esperado: ambos `551187654321` — o SQL e o TypeScript concordam.

- [ ] **Step 5: Rodar o advisor de segurança**

Usar `mcp__plugin_supabase_supabase__get_advisors` com `type: "security"`.
Esperado: nenhum alerta de tabela sem RLS. Corrigir em migration nova se houver.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260807_fundacao.sql
git commit -m "feat: schema da fundação com RLS, triggers e realtime"
```

---

### Task 7: Clientes Supabase

**Files:**
- Create: `src/integrations/supabase/client.ts`, `src/integrations/supabase/client.server.ts`
- Create: `src/integrations/supabase/types.ts` (gerado)

**Interfaces:**
- Produces: `supabase` (proxy lazy, browser/SSR, RLS ativa); `supabaseAdmin` (service role, só em `.server.ts`)

- [ ] **Step 1: Gerar os tipos do banco**

Usar `mcp__plugin_supabase_supabase__generate_typescript_types` e salvar o resultado em `src/integrations/supabase/types.ts`. 

- [ ] **Step 2: Implementar o cliente do browser**

`src/integrations/supabase/client.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";

const URL_SUPABASE =
  import.meta.env?.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const CHAVE_PUBLICAVEL =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

/**
 * As chaves novas do Supabase (sb_publishable_/sb_secret_) NÃO são JWTs.
 * Mandar `Authorization: Bearer <chave>` faz o PostgREST rejeitar — só o
 * header `apikey` deve carregá-la.
 */
function ehChaveNova(chave: string): boolean {
  return chave.startsWith("sb_publishable_") || chave.startsWith("sb_secret_");
}

export function criarFetchSupabase(chave: string): typeof fetch {
  return async (entrada, init) => {
    const headers = new Headers(init?.headers);
    if (ehChaveNova(chave) && headers.get("Authorization") === `Bearer ${chave}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", chave);
    return fetch(entrada, { ...init, headers });
  };
}

function criar() {
  if (!URL_SUPABASE || !CHAVE_PUBLICAVEL) {
    throw new Error("Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY");
  }
  return createClient<Database>(URL_SUPABASE, CHAVE_PUBLICAVEL, {
    global: { fetch: criarFetchSupabase(CHAVE_PUBLICAVEL) },
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

// Proxy lazy: não instancia (nem valida env) até o primeiro uso, para que
// importar este módulo num contexto sem env não derrube o processo.
let _cliente: ReturnType<typeof criar> | undefined;
export const supabase = new Proxy({} as ReturnType<typeof criar>, {
  get(_alvo, prop, receptor) {
    if (!_cliente) _cliente = criar();
    return Reflect.get(_cliente, prop, receptor);
  },
});
```

- [ ] **Step 3: Implementar o cliente de service role**

`src/integrations/supabase/client.server.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
import { criarFetchSupabase } from "./client.ts";
import type { Database } from "./types.ts";

// Server-only. Ignora RLS. NUNCA importar no topo de um .functions.ts ou de uma
// rota — só com `await import()` de dentro de um handler.
const URL_SUPABASE = process.env.SUPABASE_URL ?? "";
const CHAVE_SERVICO = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function criar() {
  if (!URL_SUPABASE || !CHAVE_SERVICO) {
    throw new Error("Supabase admin não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<Database>(URL_SUPABASE, CHAVE_SERVICO, {
    global: { fetch: criarFetchSupabase(CHAVE_SERVICO) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

let _admin: ReturnType<typeof criar> | undefined;
export const supabaseAdmin = new Proxy({} as ReturnType<typeof criar>, {
  get(_alvo, prop, receptor) {
    if (!_admin) _admin = criar();
    return Reflect.get(_admin, prop, receptor);
  },
});
```

- [ ] **Step 4: Verificar que compila**

Rodar: `bunx tsc --noEmit`
Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/
git commit -m "feat: clientes Supabase (browser e service role)"
```

---

### Task 8: Cliente HTTP da UAZAPI

**Files:**
- Create: `src/lib/uazapi/client.server.ts`

**Interfaces:**
- Produces: `uazapiFetch(path, opts)`; `enviarTexto(token, numero, texto)`; `baixarMensagem(token, messageId)`; `definirWebhookGlobal(url, eventos)`

- [ ] **Step 1: Implementar**

`src/lib/uazapi/client.server.ts`:
```ts
// Server-only: lê process.env e fala com a UAZAPI. Importar só via await import().

const TIMEOUT_MS = 20_000;

function baseUrl(): string {
  const url = process.env.UAZAPI_BASE_URL;
  if (!url) throw new Error("UAZAPI_BASE_URL não configurado");
  return url.replace(/\/+$/, "");
}

export async function uazapiFetch(
  path: string,
  opts: { token?: string; admin?: boolean; method?: string; body?: unknown } = {},
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.admin) {
    const adminToken = process.env.UAZAPI_ADMIN_TOKEN;
    if (!adminToken) throw new Error("UAZAPI_ADMIN_TOKEN não configurado");
    headers.admintoken = adminToken;
  }
  if (opts.token) headers.token = opts.token;

  const resposta = await fetch(`${baseUrl()}${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const texto = await resposta.text();
  let corpo: any = null;
  try { corpo = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }

  if (!resposta.ok) {
    throw new Error(`UAZAPI ${resposta.status}: ${texto.slice(0, 200)}`);
  }
  // A UAZAPI às vezes devolve 200 com corpo de erro.
  if (corpo && corpo.error === true) {
    throw new Error(`UAZAPI erro: ${JSON.stringify(corpo).slice(0, 200)}`);
  }
  return corpo;
}

export async function enviarTexto(token: string, numero: string, texto: string) {
  return uazapiFetch("/send/text", { token, body: { number: numero, text: texto } });
}

export async function baixarMensagem(token: string, messageId: string) {
  return uazapiFetch("/message/download", { token, body: { id: messageId } });
}

export async function definirWebhookGlobal(url: string, eventos: string[]) {
  return uazapiFetch("/webhook", { admin: true, body: { url, events: eventos, enabled: true } });
}
```

- [ ] **Step 2: Verificar que compila**

Rodar: `bunx tsc --noEmit`
Esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/uazapi/client.server.ts
git commit -m "feat: cliente HTTP da UAZAPI"
```

---

### Task 9: Ingest — do payload ao lead e à mensagem

O coração da fatia. Recebe um item já normalizado pelo parser e o transforma em lead + conversa + mensagem, de forma idempotente.

**Files:**
- Create: `src/lib/uazapi/ingest.server.ts`
- Create: `src/lib/uazapi/mensagem.ts` (parte pura: classificar tipo e extrair texto)
- Test: `src/lib/uazapi/mensagem.test.ts`

**Interfaces:**
- Consumes: `parseWebhookUazapi`, `resolverTelefoneReal`, `extrairAtribuicaoAnuncio`, `normalizarTelefoneBr`, `supabaseAdmin`
- Produces: `classificarMensagem(item): MensagemNormalizada` (pura); `ingerirEvento(supabaseAdmin, body): Promise<ResultadoIngest[]>` onde `ResultadoIngest = { status: "ok" | "duplicate" | "ignored" | "error"; leadId?: string; error?: string }`

- [ ] **Step 1: Escrever o teste da parte pura**

`src/lib/uazapi/mensagem.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarMensagem } from "./mensagem.ts";

test("classifica mensagem de texto simples", () => {
  const m = classificarMensagem({
    messageid: "abc",
    fromMe: false,
    messageTimestamp: 1754582400,
    content: { conversation: "Oi" },
  });
  assert.equal(m.tipo, "texto");
  assert.equal(m.conteudo, "Oi");
  assert.equal(m.direcao, "in");
  assert.equal(m.providerMessageId, "abc");
  assert.equal(m.timestampMs, 1754582400000);
});

test("marca direção out quando fromMe", () => {
  const m = classificarMensagem({ messageid: "a", fromMe: true, content: { conversation: "x" } });
  assert.equal(m.direcao, "out");
});

test("classifica áudio e guarda a legenda quando houver", () => {
  const m = classificarMensagem({
    messageid: "a",
    content: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
  });
  assert.equal(m.tipo, "audio");
  assert.equal(m.mediaMime, "audio/ogg; codecs=opus");
});

test("classifica imagem com legenda", () => {
  const m = classificarMensagem({
    messageid: "a",
    content: { imageMessage: { mimetype: "image/jpeg", caption: "olha aqui" } },
  });
  assert.equal(m.tipo, "imagem");
  assert.equal(m.conteudo, "olha aqui");
});

test("extendedTextMessage também é texto", () => {
  const m = classificarMensagem({ messageid: "a", content: { extendedTextMessage: { text: "link" } } });
  assert.equal(m.tipo, "texto");
  assert.equal(m.conteudo, "link");
});

test("tipo desconhecido vira 'outro' sem quebrar", () => {
  const m = classificarMensagem({ messageid: "a", content: { pollCreationMessage: {} } });
  assert.equal(m.tipo, "outro");
});

test("timestamp ausente vira null e não NaN", () => {
  const m = classificarMensagem({ messageid: "a", content: { conversation: "x" } });
  assert.equal(m.timestampMs, null);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './mensagem.ts'`

- [ ] **Step 3: Implementar a parte pura**

`src/lib/uazapi/mensagem.ts`:
```ts
export type TipoMensagem =
  | "texto" | "audio" | "imagem" | "video" | "documento" | "sticker" | "outro";

export type MensagemNormalizada = {
  providerMessageId: string | null;
  direcao: "in" | "out";
  tipo: TipoMensagem;
  conteudo: string | null;
  mediaMime: string | null;
  mediaFilename: string | null;
  timestampMs: number | null;
};

const MAPA_MIDIA: Array<[string, TipoMensagem]> = [
  ["audioMessage", "audio"],
  ["imageMessage", "imagem"],
  ["videoMessage", "video"],
  ["documentMessage", "documento"],
  ["stickerMessage", "sticker"],
];

export function classificarMensagem(item: any): MensagemNormalizada {
  const conteudoBruto = item?.content ?? {};
  const timestamp = Number(item?.messageTimestamp);

  const base = {
    providerMessageId: item?.messageid ?? item?.id ?? item?.key?.id ?? null,
    direcao: (item?.fromMe ? "out" : "in") as "in" | "out",
    timestampMs: Number.isFinite(timestamp) && timestamp > 0 ? timestamp * 1000 : null,
  };

  const texto = conteudoBruto.conversation ?? conteudoBruto.extendedTextMessage?.text ?? null;
  if (typeof texto === "string") {
    return { ...base, tipo: "texto", conteudo: texto, mediaMime: null, mediaFilename: null };
  }

  for (const [chave, tipo] of MAPA_MIDIA) {
    const midia = conteudoBruto[chave];
    if (midia) {
      return {
        ...base,
        tipo,
        conteudo: typeof midia.caption === "string" ? midia.caption : null,
        mediaMime: typeof midia.mimetype === "string" ? midia.mimetype : null,
        mediaFilename: typeof midia.fileName === "string" ? midia.fileName : null,
      };
    }
  }

  return { ...base, tipo: "outro", conteudo: null, mediaMime: null, mediaFilename: null };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Rodar: `bun run test`
Esperado: PASSA — 7 testes novos.

- [ ] **Step 5: Implementar o orquestrador**

`src/lib/uazapi/ingest.server.ts`:
```ts
import { parseWebhookUazapi } from "./parse.ts";
import { classificarMensagem } from "./mensagem.ts";
import { resolverTelefoneReal } from "./identidade.ts";
import { extrairAtribuicaoAnuncio } from "./anuncio.ts";
import { normalizarTelefoneBr } from "../telefone.ts";

export type ResultadoIngest = {
  status: "ok" | "duplicate" | "ignored" | "error";
  leadId?: string;
  error?: string;
};

async function acharOuCriarLead(
  admin: any,
  item: any,
): Promise<{ leadId: string; conversaId: string } | null> {
  const { telefone, jid } = resolverTelefoneReal(item, item?.key ?? {});
  const normalizado = normalizarTelefoneBr(telefone);
  const atribuicao = extrairAtribuicaoAnuncio(item?.content);

  // Sem telefone real (contato com @lid), o lead ainda é criado — ancorado no
  // JID — em vez de descartado. O telefone entra depois, se aparecer.
  const externalId = !normalizado && jid ? `wa-jid:${jid}` : null;
  if (!normalizado && !externalId) return null;

  let leadId: string | null = null;

  if (normalizado) {
    const { data } = await admin
      .from("leads").select("id").eq("telefone_normalizado", normalizado).limit(1);
    leadId = data?.[0]?.id ?? null;
  }
  if (!leadId && externalId) {
    const { data } = await admin
      .from("leads").select("id").eq("external_id", externalId).limit(1);
    leadId = data?.[0]?.id ?? null;
  }

  if (!leadId) {
    const { data, error } = await admin.from("leads").insert({
      telefone: telefone || null,
      external_id: externalId,
      nome: item?.pushName ?? item?.chat?.name ?? null,
      origem: atribuicao ? "anuncio" : "inbound",
      ad_source_id: atribuicao?.adSourceId ?? null,
      ad_source_url: atribuicao?.adSourceUrl ?? null,
      ad_title: atribuicao?.adTitle ?? null,
      ad_source_app: atribuicao?.adSourceApp ?? null,
      ad_conversion_source: atribuicao?.adConversionSource ?? null,
      ctwa_clid: atribuicao?.ctwaClid ?? null,
      ad_referral_raw: atribuicao?.referralRaw ?? null,
    }).select("id").single();
    if (error) throw new Error(error.message);
    leadId = data.id;
  } else if (atribuicao) {
    // Lead conhecido clicou num anúncio: registra a atribuição mais recente sem
    // sobrescrever com null caso ela venha incompleta.
    await admin.from("leads").update({
      ad_source_id: atribuicao.adSourceId,
      ad_source_url: atribuicao.adSourceUrl,
      ad_title: atribuicao.adTitle,
      ad_source_app: atribuicao.adSourceApp,
      ad_conversion_source: atribuicao.adConversionSource,
      ctwa_clid: atribuicao.ctwaClid,
      ad_referral_raw: atribuicao.referralRaw,
    }).eq("id", leadId).is("ad_source_id", null);
  }

  const { data: conversaExistente } = await admin
    .from("conversas").select("id").eq("lead_id", leadId).maybeSingle();
  if (conversaExistente?.id) return { leadId: leadId!, conversaId: conversaExistente.id };

  const { data: novaConversa, error: erroConversa } = await admin
    .from("conversas").insert({ lead_id: leadId }).select("id").single();
  if (erroConversa) throw new Error(erroConversa.message);
  return { leadId: leadId!, conversaId: novaConversa.id };
}

async function ingerirMensagem(admin: any, item: any): Promise<ResultadoIngest> {
  const msg = classificarMensagem(item);

  // Idempotência camada 1: pré-check antes de qualquer trabalho.
  if (msg.providerMessageId) {
    const { data } = await admin
      .from("mensagens").select("id").eq("provider_message_id", msg.providerMessageId).maybeSingle();
    if (data) return { status: "duplicate" };
  }

  const alvo = await acharOuCriarLead(admin, item);
  if (!alvo) return { status: "ignored" };

  const { error } = await admin.from("mensagens").insert({
    conversa_id: alvo.conversaId,
    lead_id: alvo.leadId,
    provider_message_id: msg.providerMessageId,
    remetente: msg.direcao === "in" ? "lead" : "humano",
    direcao: msg.direcao,
    tipo: msg.tipo,
    conteudo: msg.conteudo,
    media_mime: msg.mediaMime,
    media_filename: msg.mediaFilename,
    timestamp_ms: msg.timestampMs ?? Date.now(),
    raw: item,
  });

  if (error) {
    // Idempotência camada 2: corrida entre duas entregas do mesmo webhook.
    if ((error as any).code === "23505") return { status: "duplicate" };
    return { status: "error", error: error.message };
  }

  return { status: "ok", leadId: alvo.leadId };
}

export async function ingerirEvento(admin: any, body: unknown): Promise<ResultadoIngest[]> {
  const evento = parseWebhookUazapi(body);
  if (evento.evento !== "messages") return [];

  const resultados: ResultadoIngest[] = [];
  for (const item of evento.itens) {
    try {
      resultados.push(await ingerirMensagem(admin, item));
    } catch (err: any) {
      resultados.push({ status: "error", error: err?.message ?? "erro desconhecido" });
    }
  }
  return resultados;
}
```

- [ ] **Step 6: Verificar que compila e os testes passam**

Rodar: `bunx tsc --noEmit && bun run test`
Esperado: sem erros de tipo; todos os testes passam.

- [ ] **Step 7: Commit**

```bash
git add src/lib/uazapi/mensagem.ts src/lib/uazapi/mensagem.test.ts src/lib/uazapi/ingest.server.ts
git commit -m "feat: ingest de mensagens com idempotência e atribuição de anúncio"
```

---

### Task 10: Rota do webhook

**Files:**
- Create: `src/routes/api/public/uazapi.ts`
- Create: `src/lib/webhook-auth.server.ts`
- Test: `src/lib/webhook-auth.test.ts`

**Interfaces:**
- Consumes: `ingerirEvento`, `supabaseAdmin`
- Produces: rota `POST /api/public/uazapi`; `comparacaoSegura(a, b): boolean`

- [ ] **Step 1: Escrever o teste da comparação**

`src/lib/webhook-auth.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparacaoSegura } from "./webhook-auth.ts";

test("compara strings iguais", () => {
  assert.equal(comparacaoSegura("abc123", "abc123"), true);
});

test("rejeita strings diferentes do mesmo tamanho", () => {
  assert.equal(comparacaoSegura("abc123", "abc124"), false);
});

test("rejeita tamanhos diferentes", () => {
  assert.equal(comparacaoSegura("abc", "abcd"), false);
});

test("rejeita string vazia", () => {
  assert.equal(comparacaoSegura("", ""), true);
  assert.equal(comparacaoSegura("", "x"), false);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Rodar: `bun run test`
Esperado: FALHA — `Cannot find module './webhook-auth.ts'`

- [ ] **Step 3: Implementar a comparação e o guard**

`src/lib/webhook-auth.ts`:
```ts
/**
 * Comparação em tempo constante: evita que a diferença de tempo entre
 * comparações revele o segredo caractere a caractere.
 */
export function comparacaoSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}
```

`src/lib/webhook-auth.server.ts`:
```ts
import { comparacaoSegura } from "./webhook-auth.ts";

// Fail-closed: sem segredo configurado, nada passa.
export function segredoConfere(request: Request): boolean {
  const esperado = process.env.UAZAPI_WEBHOOK_SECRET ?? "";
  if (!esperado) return false;
  const url = new URL(request.url);
  const fornecido =
    url.searchParams.get("secret") ?? request.headers.get("x-uazapi-secret") ?? "";
  return comparacaoSegura(fornecido, esperado);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Rodar: `bun run test`
Esperado: PASSA — 4 testes novos.

- [ ] **Step 5: Implementar a rota**

`src/routes/api/public/uazapi.ts`:
```ts
import { createFileRoute } from "@tanstack/react-router";

const HEADERS_REDIGIDOS = new Set(["x-uazapi-secret", "authorization", "token", "admintoken"]);

export const Route = createFileRoute("/api/public/uazapi")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { segredoConfere } = await import("@/lib/webhook-auth.server");
        if (!segredoConfere(request)) return new Response("forbidden", { status: 403 });
        return Response.json({ ok: true, msg: "Webhook UAZAPI ativo. Envie POST aqui." });
      },

      POST: async ({ request }) => {
        const { segredoConfere } = await import("@/lib/webhook-auth.server");
        if (!segredoConfere(request)) return new Response("forbidden", { status: 403 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { ingerirEvento } = await import("@/lib/uazapi/ingest.server");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return Response.json({ ok: false, erro: "corpo inválido" }, { status: 400 });
        }

        // Auditoria ANTES de processar: se o processamento explodir, o payload
        // continua disponível para reprocessar.
        const headers: Record<string, string> = {};
        request.headers.forEach((valor, chave) => {
          headers[chave] = HEADERS_REDIGIDOS.has(chave.toLowerCase()) ? "[redacted]" : valor;
        });

        const { data: registrado } = await supabaseAdmin
          .from("webhook_events")
          .insert({
            source: "uazapi",
            event_type: String((body as any)?.EventType ?? (body as any)?.event ?? "").toLowerCase(),
            raw_body: body as any,
            headers,
            status: "processing",
            attempts: 1,
          })
          .select("id")
          .single();

        const eventoId = registrado?.id;

        try {
          const resultados = await ingerirEvento(supabaseAdmin, body);
          const falhou = resultados.find((r) => r.status === "error");

          if (falhou) {
            if (eventoId) {
              await supabaseAdmin.from("webhook_events").update({
                status: "failed",
                last_error: falhou.error ?? "erro no ingest",
                next_retry_at: new Date(Date.now() + 60_000).toISOString(),
              }).eq("id", eventoId);
            }
            // 500 faz a UAZAPI reentregar. O pré-check de idempotência torna
            // o retry seguro.
            return Response.json({ ok: false, erro: falhou.error }, { status: 500 });
          }

          if (eventoId) {
            await supabaseAdmin.from("webhook_events").update({
              status: "processed",
              processed_at: new Date().toISOString(),
            }).eq("id", eventoId);
          }
          return Response.json({ ok: true, processados: resultados.length });
        } catch (err: any) {
          if (eventoId) {
            await supabaseAdmin.from("webhook_events").update({
              status: "failed",
              last_error: err?.message ?? "erro desconhecido",
              next_retry_at: new Date(Date.now() + 60_000).toISOString(),
            }).eq("id", eventoId);
          }
          return Response.json({ ok: false, erro: err?.message }, { status: 500 });
        }
      },
    },
  },
});
```

- [ ] **Step 6: Testar a rota manualmente**

Subir o servidor: `bun run dev`

Em outro terminal, com `UAZAPI_WEBHOOK_SECRET=teste123` no `.env`:
```bash
# Deve dar 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/public/uazapi \
  -H 'Content-Type: application/json' -d '{}'

# Deve dar 200 e criar o lead
curl -s -X POST "http://localhost:3000/api/public/uazapi?secret=teste123" \
  -H 'Content-Type: application/json' \
  --data @src/lib/uazapi/fixtures/mensagem-anuncio.json

# Reenviar o MESMO payload: deve dar 200 e NÃO criar mensagem duplicada
curl -s -X POST "http://localhost:3000/api/public/uazapi?secret=teste123" \
  -H 'Content-Type: application/json' \
  --data @src/lib/uazapi/fixtures/mensagem-anuncio.json
```

Verificar no banco com `mcp__plugin_supabase_supabase__execute_sql`:
```sql
select l.telefone_normalizado, l.ad_source_id, l.ad_title, count(m.id) as mensagens
from public.leads l left join public.mensagens m on m.lead_id = l.id
group by l.id, l.telefone_normalizado, l.ad_source_id, l.ad_title;
```
Esperado: 1 lead com `ad_source_id = '120226305854810726'` e **exatamente 1 mensagem** (não 2) — a idempotência funcionou.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/public/uazapi.ts src/lib/webhook-auth.ts src/lib/webhook-auth.server.ts src/lib/webhook-auth.test.ts
git commit -m "feat: rota do webhook UAZAPI com auditoria e retry"
```

---

### Task 11: Transcrição de áudio e mídia no Storage

**Files:**
- Create: `src/lib/groq-transcribe.server.ts`
- Modify: `src/lib/uazapi/ingest.server.ts` (baixar mídia e transcrever áudio)
- Create: `supabase/migrations/20260807b_storage_midia.sql`

**Interfaces:**
- Consumes: `baixarMensagem` de `./client.server.ts`
- Produces: `transcreverAudio(bytes, mime, opts): Promise<{ ok: true; texto: string } | { ok: false; erro: string }>`; `transcreverDoStorage(admin, bucket, path, mime, idioma)`

- [ ] **Step 1: Criar o bucket de mídia**

`supabase/migrations/20260807b_storage_midia.sql`:
```sql
insert into storage.buckets (id, name, public)
values ('crm-midia', 'crm-midia', false)
on conflict (id) do nothing;

create policy "midia leitura do operador"
  on storage.objects for select to authenticated
  using (bucket_id = 'crm-midia' and public.eh_dono());
```

Aplicar via `mcp__plugin_supabase_supabase__apply_migration`.

- [ ] **Step 2: Implementar a transcrição**

`src/lib/groq-transcribe.server.ts`:
```ts
// Server-only. Transcrição via Groq (Whisper). Docs: https://console.groq.com/docs/speech-to-text
const URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODELO = "whisper-large-v3-turbo";
const TIMEOUT_MS = 60_000;

const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm",
};

function extensaoDe(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXTENSAO_POR_MIME[base] ?? "ogg";
}

export type ResultadoTranscricao =
  | { ok: true; texto: string }
  | { ok: false; erro: string };

/** Nunca lança: falha de transcrição não pode derrubar o fluxo da mensagem. */
export async function transcreverAudio(
  bytes: Uint8Array,
  mime: string,
  opts: { idioma?: string } = {},
): Promise<ResultadoTranscricao> {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) return { ok: false, erro: "GROQ_API_KEY não configurado" };

  try {
    const extensao = extensaoDe(mime);
    // Cópia para ArrayBuffer "puro" — Blob rejeita Uint8Array<SharedArrayBuffer>.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mime || `audio/${extensao}` }), `audio.${extensao}`);
    form.append("model", MODELO);
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (opts.idioma) form.append("language", opts.idioma);

    const resposta = await fetch(URL_GROQ, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const texto = await resposta.text();
    if (!resposta.ok) return { ok: false, erro: `Groq ${resposta.status}: ${texto.slice(0, 200)}` };

    let corpo: any = null;
    try { corpo = JSON.parse(texto); } catch { /* ignore */ }
    const transcrito = (corpo?.text ?? "").toString().trim();
    if (!transcrito) return { ok: false, erro: "Groq não devolveu texto" };
    return { ok: true, texto: transcrito };
  } catch (err: any) {
    return { ok: false, erro: err?.message ?? "erro desconhecido" };
  }
}

export async function transcreverDoStorage(
  admin: any, bucket: string, path: string, mime: string | null, idioma = "pt",
): Promise<ResultadoTranscricao> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) return { ok: false, erro: error?.message ?? "download falhou" };
  const buffer = await (data as Blob).arrayBuffer();
  return transcreverAudio(new Uint8Array(buffer), mime ?? "audio/ogg", { idioma });
}
```

- [ ] **Step 3: Ligar mídia e transcrição ao ingest**

Em `src/lib/uazapi/ingest.server.ts`, adicionar acima de `ingerirMensagem`:
```ts
const BUCKET_MIDIA = "crm-midia";
const TIPOS_COM_MIDIA = new Set(["audio", "imagem", "video", "documento", "sticker"]);

/** A UAZAPI devolve `fileURL` (URL cacheada) em vez de base64 — bem mais leve. */
async function baixarMidia(messageId: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) return null;
  try {
    const { baixarMensagem } = await import("./client.server.ts");
    const resposta = await baixarMensagem(token, messageId);
    const fileURL = resposta?.fileURL;

    if (!fileURL) {
      const base64 = resposta?.base64Data ?? resposta?.base64;
      if (!base64) return null;
      return {
        bytes: new Uint8Array(Buffer.from(base64, "base64")),
        mime: resposta?.mimetype ?? "application/octet-stream",
      };
    }

    const arquivo = await fetch(fileURL, { signal: AbortSignal.timeout(20_000) });
    if (!arquivo.ok) return null;
    return {
      bytes: new Uint8Array(await arquivo.arrayBuffer()),
      mime: resposta?.mimetype ?? arquivo.headers.get("content-type") ?? "application/octet-stream",
    };
  } catch {
    return null;
  }
}
```

Dentro de `ingerirMensagem`, entre `acharOuCriarLead` e o `insert`, inserir:
```ts
  let mediaPath: string | null = null;
  let transcricao: string | null = null;
  let transcricaoStatus: string | null = null;

  if (TIPOS_COM_MIDIA.has(msg.tipo) && msg.providerMessageId) {
    const midia = await baixarMidia(msg.providerMessageId);
    if (midia) {
      const extensao = (midia.mime.split("/")[1] ?? "bin").split(";")[0];
      mediaPath = `${alvo.leadId}/${msg.direcao}_${msg.providerMessageId}.${extensao}`;
      const { error: erroUpload } = await admin.storage
        .from(BUCKET_MIDIA)
        .upload(mediaPath, midia.bytes, { contentType: midia.mime, upsert: true });
      if (erroUpload) mediaPath = null;

      if (mediaPath && msg.tipo === "audio") {
        const { transcreverDoStorage } = await import("../groq-transcribe.server.ts");
        const r = await transcreverDoStorage(admin, BUCKET_MIDIA, mediaPath, midia.mime, "pt");
        if (r.ok) { transcricao = r.texto; transcricaoStatus = "ok"; }
        else { transcricaoStatus = "failed"; }
      }
    }
  }
```

E no `insert` da mensagem, acrescentar os campos:
```ts
    media_path: mediaPath,
    transcricao,
    transcricao_status: transcricaoStatus,
```

- [ ] **Step 4: Verificar que compila e os testes seguem passando**

Rodar: `bunx tsc --noEmit && bun run test`
Esperado: sem erros; todos os testes anteriores continuam passando (a parte pura não mudou).

- [ ] **Step 5: Commit**

```bash
git add src/lib/groq-transcribe.server.ts src/lib/uazapi/ingest.server.ts supabase/migrations/20260807b_storage_midia.sql
git commit -m "feat: download de mídia para o Storage e transcrição de áudio"
```

---

### Task 12: Seed de demonstração

Para conseguir abrir o sistema e ver dados reais em vez de tela vazia.

**Files:**
- Create: `scripts/semear-demo.ts`
- Modify: `package.json` (script `seed:demo`)

**Interfaces:**
- Consumes: `supabaseAdmin`
- Produces: `bun run seed:demo` — idempotente

- [ ] **Step 1: Implementar o script**

`scripts/semear-demo.ts`:
```ts
/**
 * Semeia dados FICTÍCIOS de demonstração. Idempotente: roda quantas vezes quiser.
 * Todos os telefones usam o prefixo 5511900000xxx, reservado para demo.
 */
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const LEADS_DEMO = [
  { telefone: "5511900000001", nome: "Ana (demo)", estagio: "novo", origem: "anuncio",
    ad_source_id: "120226305854810726", ad_title: "Maquininha Ton 12x", ad_source_app: "facebook",
    maquina_interesse: "T3 Smart" },
  { telefone: "5511900000002", nome: "Bruno (demo)", estagio: "qualificando", origem: "inbound",
    maquina_interesse: "T2" },
  { telefone: "5511900000003", nome: "Carla (demo)", estagio: "link_enviado", origem: "anuncio",
    ad_source_id: "120226305854810726", ad_title: "Maquininha Ton 12x", ad_source_app: "facebook",
    maquina_interesse: "T3 Smart", comissao_estimada: 590 },
  { telefone: "5511900000004", nome: "Diego (demo)", estagio: "convertido", origem: "anuncio",
    ad_source_id: "120999888777666", ad_title: "TapTon sem maquininha", ad_source_app: "instagram",
    maquina_interesse: "TapTon", comissao_estimada: 590, comissao_confirmada: 590 },
  { telefone: "5511900000005", nome: "Elisa (demo)", estagio: "perdido", origem: "inbound" },
];

const CONVERSA_DEMO = [
  { direcao: "in",  remetente: "lead",   tipo: "texto", conteudo: "Oi, vi o anúncio da maquininha" },
  { direcao: "out", remetente: "ia",     tipo: "texto", conteudo: "Oi! Que bom que se interessou. Você já vende hoje ou está começando agora?" },
  { direcao: "in",  remetente: "lead",   tipo: "texto", conteudo: "Já vendo, mas uso a maquininha de outro banco" },
  { direcao: "out", remetente: "ia",     tipo: "texto", conteudo: "Entendi. A T3 Smart costuma compensar bem nesse caso — posso te mostrar as taxas?" },
  { direcao: "in",  remetente: "lead",   tipo: "audio", conteudo: null, transcricao: "Pode sim, manda aí por favor" },
];

async function main() {
  console.log("Semeando dados de demonstração...");

  for (const lead of LEADS_DEMO) {
    const { data: existente } = await admin
      .from("leads").select("id").eq("telefone", lead.telefone).maybeSingle();

    let leadId = existente?.id;
    if (!leadId) {
      const { data, error } = await admin.from("leads").insert(lead).select("id").single();
      if (error) throw new Error(`falha ao criar ${lead.nome}: ${error.message}`);
      leadId = data.id;
      console.log(`  + lead ${lead.nome}`);
    }

    const { data: conversa } = await admin
      .from("conversas").select("id").eq("lead_id", leadId).maybeSingle();
    let conversaId = conversa?.id;
    if (!conversaId) {
      const { data } = await admin.from("conversas").insert({ lead_id: leadId }).select("id").single();
      conversaId = data!.id;
    }

    // Só o lead em "qualificando" ganha histórico de conversa, para dar o que ver no inbox.
    if (lead.estagio !== "qualificando") continue;

    const { count } = await admin
      .from("mensagens").select("id", { count: "exact", head: true }).eq("lead_id", leadId);
    if ((count ?? 0) > 0) continue;

    const base = Date.now() - CONVERSA_DEMO.length * 60_000;
    for (const [i, m] of CONVERSA_DEMO.entries()) {
      await admin.from("mensagens").insert({
        conversa_id: conversaId, lead_id: leadId,
        provider_message_id: `demo-${leadId}-${i}`,
        direcao: m.direcao, remetente: m.remetente, tipo: m.tipo,
        conteudo: m.conteudo,
        transcricao: (m as any).transcricao ?? null,
        transcricao_status: (m as any).transcricao ? "ok" : null,
        timestamp_ms: base + i * 60_000,
      });
    }
    console.log(`  + ${CONVERSA_DEMO.length} mensagens em ${lead.nome}`);
  }

  console.log("Pronto.");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Adicionar o script ao package.json**

Em `"scripts"`, acrescentar:
```json
    "seed:demo": "bun run scripts/semear-demo.ts",
```

- [ ] **Step 3: Rodar o seed**

Rodar: `bun run seed:demo`
Esperado: cria 5 leads e 5 mensagens.

- [ ] **Step 4: Rodar de novo e confirmar idempotência**

Rodar: `bun run seed:demo`
Esperado: nenhum `+` novo no log — nada foi duplicado.

Verificar com `mcp__plugin_supabase_supabase__execute_sql`:
```sql
select estagio, count(*) from public.leads where telefone like '55119000000%' group by estagio;
select count(*) as mensagens_demo from public.mensagens where provider_message_id like 'demo-%';
```
Esperado: 5 leads distribuídos nos estágios; exatamente 5 mensagens.

- [ ] **Step 5: Commit**

```bash
git add scripts/semear-demo.ts package.json
git commit -m "feat: seed de dados fictícios de demonstração"
```

---

## Verificação final da fatia

Depois da Tarefa 12, confirmar tudo junto:

- [ ] `bun run test` — todos os testes passam (38 casos: 1+7+5+7+7+7+4)
- [ ] `bunx tsc --noEmit` — sem erro de tipo
- [ ] `mcp__plugin_supabase_supabase__get_advisors type=security` — sem tabela exposta
- [ ] Webhook: enviar o fixture de anúncio duas vezes → 1 lead, 1 mensagem, `ad_source_id` preenchido
- [ ] Webhook sem segredo → 403
- [ ] `bun run seed:demo` duas vezes → nada duplicado

## Fora do escopo desta fatia

Ficam para as próximas: motor do agente de IA e fila de turnos; base de conhecimento e RAG (pgvector); telas de inbox e dashboard; autenticação e login; envio de mensagens pelo CRM; postback do CAPI (condicionado ao teste do `ctwa_clid`).
