# Fatia 5 — Perfil do WhatsApp, tags no inbox e payload dos disparos CAPI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer nome e foto reais do WhatsApp para o CRM, mostrar tags derivadas (estágio, máquina de interesse, origem Meta Ads) na lista do inbox, expor o payload/resposta de cada disparo CAPI no painel do lead, e mostrar o horário de cada mensagem dentro da própria conversa.

**Architecture:** Módulo novo `src/lib/uazapi/perfil.ts` (puro) + `perfil.server.ts` (I/O: chama `/chat/details` da UAZAPI, baixa e re-hospeda a foto num bucket privado) ligado ao `ingest.server.ts` existente. `eventos_capi` ganha duas colunas jsonb (`payload`, `resposta`) gravadas por `capi.server.ts`. URLs de foto são assinadas em lote na camada de server function (nunca no componente React, nunca guardando a URL crua do WhatsApp — ela expira). Tags e horário são só apresentação: leem colunas que já existem.

**Tech Stack:** TanStack Start (server functions), Supabase (Postgres + Storage privado), UAZAPI (`/chat/details`), React + TanStack Query, `node --test`.

## Global Constraints

- Nunca guardar a URL direta de `pps.whatsapp.net` — ela expira. Sempre baixar e re-hospedar.
- Bucket de foto é **privado** (`crm-avatars`), igual `crm-midia` — decisão do dono, diferente do CPI (que usa bucket público). URL sempre assinada, nunca pública.
- Nome do WhatsApp só sobrescreve **placeholder** (null, vazio, começando com "WhatsApp ", igual ao telefone, ou só dígitos) — nunca apaga edição manual do operador.
- Toda integração best-effort (uazapi, storage) nunca lança — falha de perfil/foto não pode custar a mensagem sendo processada. Mesmo princípio já usado em `baixarMidia`/CAPI no `ingest.server.ts`.
- Ao escrever teste que dubla retorno do Supabase/PostgREST ou da UAZAPI, **confira o formato real** (a spec `docs/superpowers/specs/2026-08-08-fatia-5-perfil-tags-e-disparos-notas.md` tem o payload real de `/chat/details` testado em produção) em vez de deduzir do código. O embed `conversas(...)` de `leads` continua sendo OBJETO, não array (`conversaEmbutida` já existe, reusar).
- DI via parâmetro `deps` opcional, por último na assinatura, só para teste — convenção já usada em `enviarTextoDoCrm`, `moverEstagio`.
- `bun run test` hoje: 474 testes, 450 pass, 0 fail, 24 skipped. `bunx tsc --noEmit`: 7 erros pré-existentes (baseline, não seu). Nenhuma task pode reduzir o baseline nem introduzir novo erro/falha.
- Nunca `git commit --amend`, `rebase` nem `stash`. Não toque a working tree enquanto outro agente pode estar com task em andamento (rodar `git status` antes de qualquer commit).

---

### Task 1: Migration — foto do lead, bucket privado, payload dos disparos CAPI

**Files:**
- Create: `supabase/migrations/20260809c_fatia5_perfil_e_payload_capi.sql`

**Interfaces:**
- Produces: coluna `leads.foto_path` (text, nullable — caminho dentro do bucket `crm-avatars`, não a URL); colunas `eventos_capi.payload` (jsonb, nullable) e `eventos_capi.resposta` (jsonb, nullable); bucket `crm-avatars` (privado) com policy de leitura para o dono.

- [ ] **Step 1: Escrever a migration**

```sql
alter table public.leads
  add column if not exists foto_path text;

alter table public.eventos_capi
  add column if not exists payload jsonb,
  add column if not exists resposta jsonb;

insert into storage.buckets (id, name, public)
values ('crm-avatars', 'crm-avatars', false)
on conflict (id) do nothing;

create policy "avatar leitura do operador"
  on storage.objects for select to authenticated
  using (bucket_id = 'crm-avatars' and public.eh_dono());
```

- [ ] **Step 2: Aplicar no projeto real via MCP do Supabase**

Use a ferramenta `mcp__plugin_supabase_supabase__apply_migration` (project_id do projeto real, já usado nas migrations anteriores desta fatia — confirme em `supabase/config.toml` ou pergunte ao dono se não souber) com o conteúdo do Step 1. Depois confirme com:

```sql
select column_name from information_schema.columns
where table_schema='public' and table_name='leads' and column_name='foto_path';

select column_name from information_schema.columns
where table_schema='public' and table_name='eventos_capi' and column_name in ('payload','resposta');

select id, public from storage.buckets where id = 'crm-avatars';
```

Espera: `foto_path` presente em `leads`; `payload` e `resposta` presentes em `eventos_capi`; bucket `crm-avatars` com `public = false`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260809c_fatia5_perfil_e_payload_capi.sql
git commit -m "feat(db): coluna de foto do lead, payload/resposta do CAPI, bucket crm-avatars"
```

---

### Task 2: `src/lib/uazapi/perfil.ts` — lógica pura de nome/placeholder

**Files:**
- Create: `src/lib/uazapi/perfil.ts`
- Test: `src/lib/uazapi/perfil.test.ts`

**Interfaces:**
- Consumes: nada (puro, sem banco, sem uazapi, sem alias — mesma regra de `src/components/crm/rotulos.ts`).
- Produces: `nomeEhPlaceholder(nome: string | null | undefined, telefone: string | null | undefined): boolean`; `escolherNomeDoPerfil(perfil: PerfilUazapi | null): string | null`; tipo `PerfilUazapi = { name?: string | null; wa_name?: string | null; wa_contactName?: string | null; image?: string | null }`. Consumido por `perfil.server.ts` (Task 3).

- [ ] **Step 1: Escrever os testes que falham**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { nomeEhPlaceholder, escolherNomeDoPerfil } from "./perfil.ts";

test("nomeEhPlaceholder: null é placeholder", () => {
  assert.equal(nomeEhPlaceholder(null, "5511987654321"), true);
});

test("nomeEhPlaceholder: string vazia ou só espaço é placeholder", () => {
  assert.equal(nomeEhPlaceholder("", "5511987654321"), true);
  assert.equal(nomeEhPlaceholder("   ", "5511987654321"), true);
});

test("nomeEhPlaceholder: começa com 'WhatsApp ' é placeholder", () => {
  assert.equal(nomeEhPlaceholder("WhatsApp 5511987654321", "5511987654321"), true);
});

test("nomeEhPlaceholder: igual ao telefone é placeholder", () => {
  assert.equal(nomeEhPlaceholder("5511987654321", "5511987654321"), true);
});

test("nomeEhPlaceholder: só dígitos (mesmo que não bata com o telefone) é placeholder", () => {
  assert.equal(nomeEhPlaceholder("61006359338", "5511987654321"), true);
});

test("nomeEhPlaceholder: nome de verdade não é placeholder — preserva edição manual", () => {
  assert.equal(nomeEhPlaceholder("Ana Paula", "5511987654321"), false);
});

test("escolherNomeDoPerfil: prioriza wa_contactName sobre name e wa_name", () => {
  const nome = escolherNomeDoPerfil({ name: "Pedro", wa_name: "Pedro Deyvson", wa_contactName: "Pedrinho" });
  assert.equal(nome, "Pedrinho");
});

test("escolherNomeDoPerfil: cai para name quando falta wa_contactName", () => {
  const nome = escolherNomeDoPerfil({ name: "Pedro", wa_name: "Pedro Deyvson" });
  assert.equal(nome, "Pedro");
});

test("escolherNomeDoPerfil: cai para wa_name quando só ele existe", () => {
  const nome = escolherNomeDoPerfil({ wa_name: "Pedro Deyvson" });
  assert.equal(nome, "Pedro Deyvson");
});

test("escolherNomeDoPerfil: perfil null ou todos os campos vazios devolve null", () => {
  assert.equal(escolherNomeDoPerfil(null), null);
  assert.equal(escolherNomeDoPerfil({ name: "", wa_name: "   " }), null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bun test src/lib/uazapi/perfil.test.ts`
Expected: FAIL — `perfil.ts` não existe ainda.

- [ ] **Step 3: Implementar**

```typescript
// src/lib/uazapi/perfil.ts
// Puro: sem banco, sem uazapi, sem alias — mesma regra de rotulos.ts, para o
// node --test importar direto.

export type PerfilUazapi = {
  name?: string | null;
  wa_name?: string | null;
  wa_contactName?: string | null;
  image?: string | null;
};

/**
 * Só sobrescrevemos nome PLACEHOLDER — nunca edição manual do operador.
 * Critério espelhado do CPI (src/lib/uazapi/profile.ts, isPlaceholderName):
 * vazio, começa com "WhatsApp ", igual ao telefone, ou só dígitos (mesmo que
 * não bata com o telefone — "61006359338" é lixo de ingestão, não um nome).
 */
export function nomeEhPlaceholder(
  nome: string | null | undefined,
  telefone: string | null | undefined,
): boolean {
  const n = (nome ?? "").trim();
  if (!n) return true;
  if (n.startsWith("WhatsApp ")) return true;
  if (telefone && n === telefone.trim()) return true;
  if (/^\d+$/.test(n)) return true;
  return false;
}

/** Prioridade: wa_contactName (só quem está na agenda do número) > name >
 *  wa_name. Campos vazios/só espaço contam como ausentes. */
export function escolherNomeDoPerfil(perfil: PerfilUazapi | null | undefined): string | null {
  const candidatos = [perfil?.wa_contactName, perfil?.name, perfil?.wa_name];
  for (const c of candidatos) {
    const t = (c ?? "").trim();
    if (t) return t;
  }
  return null;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `bun test src/lib/uazapi/perfil.test.ts`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/uazapi/perfil.ts src/lib/uazapi/perfil.test.ts
git commit -m "feat(uazapi): lógica pura de nome/placeholder do perfil do WhatsApp"
```

---

### Task 3: `perfil.server.ts` — busca o perfil, baixa a foto, atualiza o lead

**Files:**
- Modify: `src/lib/uazapi/client.server.ts` (adiciona `obterDetalhesDoChat`)
- Create: `src/lib/uazapi/perfil.server.ts`
- Test: `src/lib/uazapi/perfil.server.test.ts`

**Interfaces:**
- Consumes: `nomeEhPlaceholder`, `escolherNomeDoPerfil`, `PerfilUazapi` (Task 2); `uazapiFetch` (`client.server.ts`, já existe).
- Produces: `obterDetalhesDoChat(token: string, numero: string): Promise<PerfilUazapi | null>` (em `client.server.ts`); `sincronizarPerfil(admin: any, leadId: string, telefone: string | null, deps?: DepsPerfil): Promise<{ atualizouNome: boolean; atualizouFoto: boolean }>` (em `perfil.server.ts`). Consumido por `ingest.server.ts` (Task 4).

- [ ] **Step 1: Escrever os testes que falham (perfil.server.test.ts)**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { sincronizarPerfil } from "./perfil.server.ts";

const TELEFONE = "5511987654321";

function adminComLead(overrides: Record<string, any> = {}) {
  return criarAdminFake({
    "leads.select": {
      data: { id: "L1", nome: null, foto_path: null, ...overrides },
      error: null,
    },
  });
}

test("sincronizarPerfil sem telefone não faz nada", async () => {
  const admin = adminComLead();
  const r = await sincronizarPerfil(admin, "L1", null);
  assert.deepEqual(r, { atualizouNome: false, atualizouFoto: false });
  assert.equal(admin.chamadas.some((c) => c.operacao === "update"), false);
});

test("sincronizarPerfil: nome e foto já preenchidos e não-placeholder não chama a UAZAPI", async () => {
  const admin = adminComLead({ nome: "Ana Paula", foto_path: "L1.jpg" });
  let chamouBusca = false;
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => { chamouBusca = true; return null; },
  });
  assert.equal(chamouBusca, false, "nada a atualizar não deveria custar uma chamada externa");
  assert.deepEqual(r, { atualizouNome: false, atualizouFoto: false });
});

test("sincronizarPerfil atualiza nome placeholder e grava foto nova", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ wa_contactName: "Pedrinho", image: "https://pps.whatsapp.net/foo.jpg" }),
    baixarImagem: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" }),
    enviarImagem: async () => ({ ok: true }),
  });
  assert.deepEqual(r, { atualizouNome: true, atualizouFoto: true });

  const updates = admin.chamadas.filter((c) => c.tabela === "leads" && c.operacao === "update");
  const nomeGravado = updates.find((u) => u.payload.nome !== undefined);
  assert.equal(nomeGravado?.payload.nome, "Pedrinho");
  const fotoGravada = updates.find((u) => u.payload.foto_path !== undefined);
  assert.equal(fotoGravada?.payload.foto_path, "L1.jpg");
});

test("sincronizarPerfil não sobrescreve nome editado manualmente", async () => {
  const admin = adminComLead({ nome: "Ana Paula (cliente confirmado)", foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ name: "outro nome qualquer" }),
  });
  assert.equal(r.atualizouNome, false);
  const updates = admin.chamadas.filter((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(updates.some((u) => u.payload.nome !== undefined), false);
});

test("sincronizarPerfil sem foto no perfil não tenta baixar nada", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  let chamouBaixar = false;
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ name: "Pedro" }),
    baixarImagem: async () => { chamouBaixar = true; return null; },
  });
  assert.equal(r.atualizouFoto, false);
  assert.equal(chamouBaixar, false);
});

test("sincronizarPerfil nunca lança — falha da UAZAPI vira resultado sem update", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => { throw new Error("UAZAPI 500"); },
  });
  assert.deepEqual(r, { atualizouNome: false, atualizouFoto: false });
});

test("sincronizarPerfil: falha ao baixar a imagem não impede o nome de ser gravado", async () => {
  const admin = adminComLead({ nome: null, foto_path: null });
  const r = await sincronizarPerfil(admin, "L1", TELEFONE, {
    buscarPerfil: async () => ({ name: "Pedro", image: "https://pps.whatsapp.net/foo.jpg" }),
    baixarImagem: async () => null,
  });
  assert.equal(r.atualizouNome, true);
  assert.equal(r.atualizouFoto, false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bun test src/lib/uazapi/perfil.server.test.ts`
Expected: FAIL — `perfil.server.ts` não existe.

- [ ] **Step 3: Adicionar `obterDetalhesDoChat` em `client.server.ts`**

Adicione, junto das outras funções de `client.server.ts` (depois de `baixarMensagem`):

```typescript
/**
 * `/chat/details` (== `/chat/GetNameAndImageURL`, mesmo endpoint por dois
 * nomes — confirmado contra a UAZAPI real em 08/08/2026, ver spec da Fatia 5).
 * Devolve null em vez de lançar quando o contato não existe ou a resposta não
 * traz nada útil — quem chama decide o que fazer com "sem perfil".
 */
export async function obterDetalhesDoChat(token: string, numero: string): Promise<any | null> {
  const resposta = await uazapiFetch("/chat/details", { token, body: { number: numero, preview: false } });
  return resposta ?? null;
}
```

- [ ] **Step 4: Implementar `perfil.server.ts`**

```typescript
// src/lib/uazapi/perfil.server.ts
// I/O: UAZAPI (perfil + imagem) e Storage (bucket crm-avatars). Nunca lança —
// best-effort, mesmo princípio de baixarMidia em ingest.server.ts: uma falha
// aqui não pode custar o processamento da mensagem que disparou a sincronização.
import { nomeEhPlaceholder, escolherNomeDoPerfil, type PerfilUazapi } from "./perfil.ts";

const BUCKET_AVATARS = "crm-avatars";

export type DepsPerfil = {
  /** Injetáveis só para teste. Em produção resolvem para UAZAPI/fetch/Storage reais. */
  buscarPerfil?: (numero: string) => Promise<PerfilUazapi | null>;
  baixarImagem?: (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  enviarImagem?: (
    admin: any,
    path: string,
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{ ok: boolean }>;
};

async function buscarPerfilReal(numero: string): Promise<PerfilUazapi | null> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) return null;
  const { obterDetalhesDoChat } = await import("./client.server.ts");
  return obterDetalhesDoChat(token, numero);
}

async function baixarImagemReal(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resposta.ok) return null;
    return {
      bytes: new Uint8Array(await resposta.arrayBuffer()),
      mime: resposta.headers.get("content-type") ?? "image/jpeg",
    };
  } catch {
    return null;
  }
}

async function enviarImagemReal(
  admin: any,
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ ok: boolean }> {
  const { error } = await admin.storage
    .from(BUCKET_AVATARS)
    .upload(path, bytes, { contentType: mime, upsert: true });
  return { ok: !error };
}

/**
 * Busca nome/foto reais do WhatsApp e atualiza o lead — só o que falta.
 * Curto-circuita ANTES de qualquer chamada externa quando não há nada a
 * atualizar (nome já é de verdade e foto já existe): evita martelar a UAZAPI
 * a cada mensagem de um lead que simplesmente não tem foto no WhatsApp.
 */
export async function sincronizarPerfil(
  admin: any,
  leadId: string,
  telefone: string | null,
  deps: DepsPerfil = {},
): Promise<{ atualizouNome: boolean; atualizouFoto: boolean }> {
  const NADA = { atualizouNome: false, atualizouFoto: false };
  if (!telefone) return NADA;

  try {
    const { data: lead } = await admin
      .from("leads")
      .select("nome, foto_path")
      .eq("id", leadId)
      .maybeSingle();

    const precisaNome = nomeEhPlaceholder(lead?.nome, telefone);
    const precisaFoto = !lead?.foto_path;
    if (!precisaNome && !precisaFoto) return NADA;

    const buscar = deps.buscarPerfil ?? buscarPerfilReal;
    const perfil = await buscar(telefone);
    if (!perfil) return NADA;

    let atualizouNome = false;
    if (precisaNome) {
      const nomeNovo = escolherNomeDoPerfil(perfil);
      if (nomeNovo) {
        await admin.from("leads").update({ nome: nomeNovo }).eq("id", leadId);
        atualizouNome = true;
      }
    }

    let atualizouFoto = false;
    if (precisaFoto && perfil.image) {
      const baixar = deps.baixarImagem ?? baixarImagemReal;
      const imagem = await baixar(perfil.image);
      if (imagem) {
        const extensao = (imagem.mime.split("/")[1] ?? "jpg").split(";")[0];
        const path = `${leadId}.${extensao}`;
        const enviar = deps.enviarImagem ?? enviarImagemReal;
        const resultado = await enviar(admin, path, imagem.bytes, imagem.mime);
        if (resultado.ok) {
          await admin.from("leads").update({ foto_path: path }).eq("id", leadId);
          atualizouFoto = true;
        }
      }
    }

    return { atualizouNome, atualizouFoto };
  } catch (err: any) {
    console.warn(`[perfil] falha ao sincronizar perfil do lead ${leadId}:`, err?.message ?? err);
    return NADA;
  }
}
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `bun test src/lib/uazapi/perfil.server.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 6: Rodar a suíte inteira e o typecheck**

Run: `bun run test && bunx tsc --noEmit`
Expected: todos os testes anteriores continuam passando (nenhuma queda no total); tsc no baseline de 7 erros pré-existentes (nenhum novo).

- [ ] **Step 7: Commit**

```bash
git add src/lib/uazapi/client.server.ts src/lib/uazapi/perfil.server.ts src/lib/uazapi/perfil.server.test.ts
git commit -m "feat(uazapi): sincronizarPerfil busca nome/foto reais e atualiza o lead"
```

---

### Task 4: Ligar `sincronizarPerfil` no `ingest.server.ts`

**Files:**
- Modify: `src/lib/uazapi/ingest.server.ts`
- Test: `src/lib/uazapi/ingest.server.test.ts`

**Interfaces:**
- Consumes: `sincronizarPerfil` (Task 3).
- Produces: nada de novo para outras tasks — ponto final do fluxo de perfil.

- [ ] **Step 1: Ler `ingest.server.test.ts` inteiro primeiro**

**Atenção, ele NÃO usa o `admin-fake.ts` de `src/lib/crm/`.** Este arquivo define seu próprio fake local (`criarAdminFake`, no topo do arquivo): um banco em memória de verdade (`_tabelas.leads/conversas/mensagens`), sem qualquer mecanismo de espionar `import()` dinâmico — não existe `mock.module` em uso em nenhum teste deste projeto. As 3 chamadas best-effort que `ingerirMensagem` já faz hoje (CAPI LeadSubmitted, self-healing de CAPI, agendar resposta) **não são espionadas aqui** — elas rodam de verdade contra esse fake e ficam inertes porque as env vars que precisariam (`META_PIXEL_ID`, etc.) não estão setadas no ambiente de teste. `sincronizarPerfil` vai se comportar do mesmo jeito: sem `UAZAPI_TOKEN` setado, `buscarPerfilReal` devolve `null` e a função inteira vira no-op seguro — dá pra testar a integração real, sem mock nenhum, contanto que o teste garanta que `UAZAPI_TOKEN` não está setado.

- [ ] **Step 2: Escrever o teste que falha**

Adicione ao fim de `ingest.server.test.ts`:

```typescript
test("mensagem de lead novo é processada normalmente com a sincronização de perfil ligada (sem UAZAPI_TOKEN, é no-op)", async () => {
  const tokenOriginal = process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_TOKEN;
  try {
    const admin = criarAdminFake();
    const payload = {
      EventType: "messages",
      instance: "instancia-teste",
      message: {
        messageid: "MSG-PERFIL-1",
        key: { remoteJid: "5511987654321@s.whatsapp.net" },
        content: { conversation: "quero saber mais" },
        messageTimestamp: 1_700_000_100,
        pushName: "Cliente Teste",
      },
    };

    const resultados = await ingerirEvento(admin, payload);

    assert.equal(resultados.length, 1);
    assert.equal(resultados[0].status, "ok");
    assert.equal(admin._tabelas.leads.length, 1, "o lead foi criado normalmente");
    assert.equal(admin._tabelas.mensagens.length, 1, "a mensagem foi gravada normalmente");
    // Sem UAZAPI_TOKEN, sincronizarPerfil não tem como ter mudado nada —
    // confirma que ela rodou (não quebrou o fluxo) e não sujou o lead.
    assert.equal(admin._tabelas.leads[0].foto_path, undefined);
  } finally {
    if (tokenOriginal !== undefined) process.env.UAZAPI_TOKEN = tokenOriginal;
  }
});

test("uma segunda mensagem de entrada do mesmo lead continua sendo processada com a sincronização de perfil ligada", async () => {
  const tokenOriginal = process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_TOKEN;
  try {
    const admin = criarAdminFake();
    const base = {
      EventType: "messages",
      instance: "instancia-teste",
      message: {
        key: { remoteJid: "5511987654321@s.whatsapp.net" },
        messageTimestamp: 1_700_000_100,
      },
    };
    await ingerirEvento(admin, { ...base, message: { ...base.message, messageid: "MSG-A", content: { conversation: "oi" } } });
    const resultados = await ingerirEvento(admin, { ...base, message: { ...base.message, messageid: "MSG-B", content: { conversation: "tudo bem?" } } });

    assert.equal(resultados[0].status, "ok");
    assert.equal(admin._tabelas.leads.length, 1, "mesma pessoa, não duplica o lead");
    assert.equal(admin._tabelas.mensagens.length, 2);
  } finally {
    if (tokenOriginal !== undefined) process.env.UAZAPI_TOKEN = tokenOriginal;
  }
});
```

Este é o mesmo nível de cobertura que o resto do arquivo já dá às outras chamadas best-effort de `ingerirMensagem` — a lógica de `sincronizarPerfil` em si (quando busca, quando atualiza, quando não faz nada) já está inteiramente coberta pelos testes com DI da Task 3 (`perfil.server.test.ts`), que são os que realmente testam o comportamento; aqui só confirma que ligar a chamada não quebra o fluxo de ingestão.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `bun test src/lib/uazapi/ingest.server.test.ts`
Expected: os dois testes novos PASSAM até aqui (a chamada ainda não existe em `ingerirMensagem`, então o comportamento é idêntico ao de hoje) — não há o que falhar ainda. Isso é esperado: o Step 4 é o que muda o comportamento. Pule para o Step 4 e volte a rodar no Step 5 para a verificação de verdade.

- [ ] **Step 4: Ligar a chamada em `ingerirMensagem`**

Em `src/lib/uazapi/ingest.server.ts`, dentro de `ingerirMensagem`, logo depois do bloco de self-healing de CAPI (depois da linha ~236, antes do bloco de mídia) adicione:

```typescript
  // Perfil (nome/foto reais do WhatsApp): lead novo sempre, lead existente só
  // em mensagem de ENTRADA — mesma regra do CPI (spec Fatia 5), para não
  // martelar a UAZAPI a cada mensagem que NÓS mandamos. sincronizarPerfil já
  // curto-circuita internamente quando não há nada a atualizar.
  if (alvo.leadNovo || msg.direcao === "in") {
    try {
      const { sincronizarPerfil } = await import("./perfil.server.ts");
      const { telefone } = resolverTelefoneReal(item, item?.key ?? {});
      await sincronizarPerfil(admin, alvo.leadId, telefone || null);
    } catch (err: any) {
      console.warn(`[ingest] falha ao sincronizar perfil do lead ${alvo.leadId}:`, err?.message ?? err);
    }
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `bun test src/lib/uazapi/ingest.server.test.ts`
Expected: PASS, todos os testes (os 4 novos + os que já existiam).

- [ ] **Step 6: Suíte inteira + typecheck**

Run: `bun run test && bunx tsc --noEmit`
Expected: baseline mantido (nenhuma queda de teste, nenhum novo erro de tsc).

- [ ] **Step 7: Commit**

```bash
git add src/lib/uazapi/ingest.server.ts src/lib/uazapi/ingest.server.test.ts
git commit -m "feat(uazapi): ingest sincroniza nome/foto do lead com o perfil real do WhatsApp"
```

---

### Task 5: Payload e resposta de cada disparo CAPI, visíveis no painel do lead

**Files:**
- Modify: `src/lib/capi/capi.server.ts` (grava `payload`/`resposta` nos dois pontos de insert em `eventos_capi`; nova função `listarDisparosCapi`)
- Modify: `src/lib/crm/crm.functions.ts` (nova server function `listarDisparosCapiDoLead`)
- Modify: `src/components/crm/PainelLead.tsx` (bloco novo de disparos)
- Test: `src/lib/capi/capi.server.test.ts`

**Interfaces:**
- Consumes: nada de novo de outras tasks.
- Produces: `listarDisparosCapi(admin: any, leadId: string): Promise<any[]>` em `capi.server.ts`; server function `listarDisparosCapiDoLead` em `crm.functions.ts`.

- [ ] **Step 1: Ler `capi.server.test.ts` inteiro primeiro**

O `criarAdminFake` local deste arquivo (topo, linhas 13-41) só implementa `select/insert/eq/then` — sem `.order()`. Você vai precisar dele em `listarDisparosCapi` (Step 5 abaixo), então acrescente um método `order() { return self; }` (no-op, encadeável) ao `builder` desse fake ANTES de escrever o teste de `listarDisparosCapi` — sem isso o teste quebra com "order is not a function", não porque o código de produção esteja errado.

- [ ] **Step 2: Escrever os testes que falham**

Acrescente a `capi.server.test.ts`, reusando o `stubFetch` e o padrão exato de salvar/restaurar env vars já usados nos testes de sucesso/erro existentes (linhas 122-168):

```typescript
test("enviarEventoCapi grava payload e resposta no insert de sucesso", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: true, status: 200, body: { events_received: 1, fbtrace_id: "trace-payload" } });
  try {
    const admin = criarAdminFake();
    await enviarEventoCapi(admin, "lead-payload", "LeadSubmitted", { ctwaClid: "clid-1", telefone: "5511999999999" });

    const linha = admin._tabelas.eventos_capi[0];
    assert.equal(linha.payload?.data?.[0]?.event_name, "LeadSubmitted");
    assert.ok(linha.payload?.data?.[0]?.user_data, "payload guarda o user_data mandado pra Meta");
    assert.deepEqual(linha.resposta, { events_received: 1, fbtrace_id: "trace-payload" });
  } finally {
    restaurarFetch();
    if (antesPixel === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = antesPixel;
    if (antesToken === undefined) delete process.env.META_CAPI_TOKEN; else process.env.META_CAPI_TOKEN = antesToken;
    delete process.env.META_PAGE_ID;
  }
});

test("enviarEventoCapi grava payload e resposta mesmo quando a Meta responde erro", async () => {
  const antesPixel = process.env.META_PIXEL_ID;
  const antesToken = process.env.META_CAPI_TOKEN;
  process.env.META_PIXEL_ID = "pixel-teste";
  process.env.META_CAPI_TOKEN = "token-teste";
  process.env.META_PAGE_ID = "pagina-teste";
  const restaurarFetch = stubFetch({ ok: false, status: 400, body: { error: { message: "Invalid parameter", error_subcode: 2804116 } } });
  try {
    const admin = criarAdminFake();
    await enviarEventoCapi(admin, "lead-erro", "LeadSubmitted", { ctwaClid: "clid-1" });

    const linha = admin._tabelas.eventos_capi[0];
    assert.equal(linha.payload?.data?.[0]?.event_name, "LeadSubmitted", "payload gravado mesmo em erro");
    // resposta é o JSON CRU que a Meta devolveu — status_resposta (já
    // existente) é que guarda a string formatada de detalharErroMeta.
    assert.deepEqual(linha.resposta, { error: { message: "Invalid parameter", error_subcode: 2804116 } });
    assert.ok(linha.status_resposta.startsWith("erro:400:"));
  } finally {
    restaurarFetch();
    if (antesPixel === undefined) delete process.env.META_PIXEL_ID; else process.env.META_PIXEL_ID = antesPixel;
    if (antesToken === undefined) delete process.env.META_CAPI_TOKEN; else process.env.META_CAPI_TOKEN = antesToken;
    delete process.env.META_PAGE_ID;
  }
});

test("listarDisparosCapi devolve os disparos do lead", async () => {
  const admin = criarAdminFake([
    { id: "e1", lead_id: "lead-1", nome_evento: "LeadSubmitted", enviado_em: "2026-08-08T10:00:00Z", status_resposta: "ok", payload: { a: 1 }, resposta: { b: 2 } },
    { id: "e2", lead_id: "lead-2", nome_evento: "AddToCart", enviado_em: "2026-08-08T11:00:00Z", status_resposta: "ok", payload: {}, resposta: {} },
  ]);
  const { listarDisparosCapi } = await import("./capi.server.ts");
  const r = await listarDisparosCapi(admin, "lead-1");
  assert.equal(r.length, 1);
  assert.equal(r[0].nome_evento, "LeadSubmitted");
  assert.deepEqual(r[0].payload, { a: 1 });
  assert.deepEqual(r[0].resposta, { b: 2 });
});
```

Ajuste o import no topo do arquivo para incluir `listarDisparosCapi` junto de `detalharErroMeta, enviarEventoCapi, sincronizarEventosCapi` (linha 3).

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `bun test src/lib/capi/capi.server.test.ts`
Expected: FAIL nos 3 testes novos (payload/resposta undefined nos dois primeiros; `listarDisparosCapi` não existe no terceiro).

- [ ] **Step 4: Gravar payload/resposta nos dois pontos de insert**

Em `src/lib/capi/capi.server.ts`, no insert de sucesso (dentro do `try` principal, por volta da linha 151):

```typescript
    try {
      await admin.from("eventos_capi").insert({
        lead_id: leadId,
        nome_evento: eventName,
        event_id: eventId,
        enviado_em: new Date().toISOString(),
        status_resposta: statusResposta,
        payload,
        resposta: parsed ?? { texto_cru: texto.slice(0, 500) },
      });
    } catch (err: any) {
```

E no insert do bloco `catch` externo (por volta da linha 173, onde não há `payload`/`parsed` no escopo — a exceção pode ter acontecido antes de montar o payload):

```typescript
    try {
      await admin.from("eventos_capi").insert({
        lead_id: leadId,
        nome_evento: eventName,
        event_id: eventId,
        enviado_em: new Date().toISOString(),
        status_resposta: `erro:exceção:${String(err?.message ?? err).slice(0, 200)}`,
        payload: payloadParaGravar ?? null,
      });
    } catch { /* best-effort — não pode quebrar o fluxo principal */ }
```

Para isso, mova a montagem de `payload` (a chamada a `montarPayloadEvento`) para uma variável `payloadParaGravar` declarada ANTES do `try` que envolve o fetch, atribuída assim que `montarPayloadEvento` retornar — se a exceção acontecer depois desse ponto (ex.: no `fetch`), `payloadParaGravar` já existe; se acontecer antes (ex.: em `construirUserDataHasheado`), continua `null`. Ajuste o `let payloadParaGravar: any = null;` logo antes do `try` e atribua `payloadParaGravar = payload;` logo depois de `montarPayloadEvento`.

- [ ] **Step 5: Adicionar `listarDisparosCapi`**

Ao fim de `src/lib/capi/capi.server.ts`:

```typescript
/**
 * Disparos CAPI de um lead, mais recente primeiro — para o painel mostrar o
 * que foi mandado e o que a Meta respondeu. Só para o dono (a chamada em
 * crm.functions.ts já está atrás de exigirSessao): o payload carrega
 * ph/external_id hasheados e o ctwa_clid em texto puro.
 */
export async function listarDisparosCapi(admin: any, leadId: string): Promise<any[]> {
  const { data } = await admin
    .from("eventos_capi")
    .select("id, nome_evento, event_id, enviado_em, status_resposta, payload, resposta")
    .eq("lead_id", leadId)
    .order("enviado_em", { ascending: false, nullsFirst: false });
  return data ?? [];
}
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `bun test src/lib/capi/capi.server.test.ts`
Expected: PASS, todos os testes.

- [ ] **Step 7: Server function e UI**

Em `src/lib/crm/crm.functions.ts`, junto das outras leituras por lead:

```typescript
export const listarDisparosCapiDoLead = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarDisparosCapi } = await import("../capi/capi.server.ts");
    return listarDisparosCapi(supabaseAdmin, data.leadId);
  });
```

Em `src/components/crm/PainelLead.tsx`: importe `listarDisparosCapiDoLead`, adicione uma query e um bloco de exibição logo depois do bloco "Veio de anúncio" (linha ~221):

```typescript
  const disparosQuery = useQuery({
    queryKey: ["disparos-capi", leadId],
    queryFn: () => comSessao(listarDisparosCapiDoLead({ data: { leadId } })),
    enabled: Boolean(leadId),
  });
```

```tsx
      {(disparosQuery.data?.length ?? 0) > 0 && (
        <details className="rounded bg-[var(--color-painel)] p-2">
          <summary className="cursor-pointer">
            <strong>Disparos CAPI (Meta)</strong>{" "}
            <span className="text-xs text-[var(--color-suave)]">
              {disparosQuery.data!.length} evento(s)
            </span>
          </summary>
          <ul className="mt-2 flex flex-col gap-2 text-xs">
            {disparosQuery.data!.map((d: any) => (
              <li key={d.id} className="rounded border border-[var(--color-borda)] p-2">
                <div className="flex justify-between">
                  <strong>{d.nome_evento}</strong>
                  <span className={d.status_resposta === "ok" ? "" : "text-[var(--color-alerta)]"}>
                    {d.status_resposta === "ok" ? "ok" : d.status_resposta}
                  </span>
                </div>
                <details>
                  <summary className="cursor-pointer text-[var(--color-suave)]">payload/resposta</summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify({ payload: d.payload, resposta: d.resposta }, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
```

- [ ] **Step 8: Suíte inteira + typecheck + build**

Run: `bun run test && bunx tsc --noEmit && bun run build`
Expected: baseline mantido nos três.

- [ ] **Step 9: Commit**

```bash
git add src/lib/capi/capi.server.ts src/lib/capi/capi.server.test.ts src/lib/crm/crm.functions.ts src/components/crm/PainelLead.tsx
git commit -m "feat(capi): grava payload/resposta de cada disparo e mostra no painel do lead"
```

---

### Task 6: Foto e tags derivadas no inbox

**Files:**
- Create: `src/lib/crm/fotos.ts`
- Test: `src/lib/crm/fotos.test.ts`
- Modify: `src/lib/crm/conversas.server.ts` (`listarConversas` seleciona `foto_path`, `maquina_interesse`, `origem`, `ad_title`)
- Modify: `src/lib/crm/crm.functions.ts` (`listarConversasDoInbox` chama `anexarFotosAssinadas`)
- Modify: `src/components/crm/ListaConversas.tsx` (avatar + chips de máquina/anúncio)
- Test: `src/lib/crm/conversas.server.test.ts`

**Interfaces:**
- Consumes: `conversaEmbutida` (`rotulos.ts`, já existe).
- Produces: `anexarFotosAssinadas(admin: any, leads: any[], deps?: DepsFotos): Promise<any[]>` (cada lead ganha `foto_url` quando tinha `foto_path`).

- [ ] **Step 1: Escrever os testes que falham (fotos.test.ts)**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { anexarFotosAssinadas } from "./fotos.ts";

test("anexarFotosAssinadas não toca a lista quando nenhum lead tem foto", async () => {
  const leads = [{ id: "L1", foto_path: null }, { id: "L2" }];
  const r = await anexarFotosAssinadas({}, leads);
  assert.deepEqual(r, leads);
});

test("anexarFotosAssinadas assina em UMA chamada em lote, não uma por lead", async () => {
  const leads = [
    { id: "L1", foto_path: "L1.jpg" },
    { id: "L2", foto_path: "L2.jpg" },
    { id: "L3", foto_path: null },
  ];
  let chamadas = 0;
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async (_admin, caminhos) => {
      chamadas++;
      assert.deepEqual(caminhos, ["L1.jpg", "L2.jpg"]);
      return new Map([["L1.jpg", "https://signed/L1"], ["L2.jpg", "https://signed/L2"]]);
    },
  });
  assert.equal(chamadas, 1);
  assert.equal(r[0].foto_url, "https://signed/L1");
  assert.equal(r[1].foto_url, "https://signed/L2");
  assert.equal(r[2].foto_url, undefined);
});

test("anexarFotosAssinadas preserva os outros campos do lead", async () => {
  const leads = [{ id: "L1", foto_path: "L1.jpg", nome: "Ana" }];
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async () => new Map([["L1.jpg", "https://signed/L1"]]),
  });
  assert.equal(r[0].nome, "Ana");
  assert.equal(r[0].id, "L1");
});

test("anexarFotosAssinadas: caminho sem URL assinada (falha do storage) não quebra, só fica sem foto_url", async () => {
  const leads = [{ id: "L1", foto_path: "L1.jpg" }];
  const r = await anexarFotosAssinadas({}, leads, {
    assinarEmLote: async () => new Map(),
  });
  assert.equal(r[0].foto_url, null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bun test src/lib/crm/fotos.test.ts`
Expected: FAIL — `fotos.ts` não existe.

- [ ] **Step 3: Implementar `fotos.ts`**

```typescript
// src/lib/crm/fotos.ts
// Assina em LOTE (uma chamada ao Storage, não uma por lead) as fotos dos
// leads que a lista do inbox vai mostrar. Bucket privado (crm-avatars) —
// decisão do dono, diferente do CPI que usa bucket público.

const BUCKET_AVATARS = "crm-avatars";
const SEGUNDOS_DE_VALIDADE = 300;

export type DepsFotos = {
  /** Injetável só para teste. */
  assinarEmLote?: (admin: any, caminhos: string[]) => Promise<Map<string, string>>;
};

async function assinarEmLoteReal(admin: any, caminhos: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const { data, error } = await admin.storage
    .from(BUCKET_AVATARS)
    .createSignedUrls(caminhos, SEGUNDOS_DE_VALIDADE);
  if (error || !data) return mapa;
  for (const item of data) {
    if (item?.signedUrl && item?.path) mapa.set(item.path, item.signedUrl);
  }
  return mapa;
}

/** Devolve os mesmos leads, cada um com `foto_url` (string ou null) quando
 *  tinha `foto_path`. Leads sem foto_path não ganham a propriedade. */
export async function anexarFotosAssinadas(
  admin: any,
  leads: any[],
  deps: DepsFotos = {},
): Promise<any[]> {
  const caminhos = [...new Set(leads.map((l) => l.foto_path).filter(Boolean))] as string[];
  if (caminhos.length === 0) return leads;

  const assinar = deps.assinarEmLote ?? assinarEmLoteReal;
  const mapa = await assinar(admin, caminhos);

  return leads.map((l) =>
    l.foto_path ? { ...l, foto_url: mapa.get(l.foto_path) ?? null } : l,
  );
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `bun test src/lib/crm/fotos.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: `listarConversas` seleciona as colunas novas**

`conversas.server.test.ts` ainda não tem NENHUM teste de `listarConversas` — escreva um novo, usando o `criarAdminFake` de `./admin-fake.ts` (já importado no topo do arquivo, mesmo padrão dos outros testes deste arquivo):

```typescript
test("listarConversas devolve as colunas de perfil e atribuição do lead", async () => {
  const admin = criarAdminFake({
    "leads.select": {
      data: [
        {
          id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "qualificando",
          foto_path: "L1.jpg", maquina_interesse: "T3 Smart", origem: "anuncio", ad_title: "Campanha Agosto",
          conversas: { id: "C1", pausada_pela_ia: false },
        },
      ],
      error: null,
    },
  });
  const { listarConversas } = await import("./conversas.server.ts");
  const r = await listarConversas(admin, 50);
  assert.equal(r.length, 1);
  assert.equal(r[0].foto_path, "L1.jpg");
  assert.equal(r[0].maquina_interesse, "T3 Smart");
  assert.equal(r[0].origem, "anuncio");
  assert.equal(r[0].ad_title, "Campanha Agosto");
});
```

Depois, em `src/lib/crm/conversas.server.ts`, no `.select(...)` de `listarConversas`, acrescente `foto_path, maquina_interesse, origem, ad_title` à lista de colunas de `leads` (mantendo `conversas(...)` como já está). Rode `bun test src/lib/crm/conversas.server.test.ts` antes e depois da mudança — antes o teste novo falha (`r[0].foto_path` é `undefined`, o fake devolve os dados mas a asserção só falha se o SELECT real não pedisse essas colunas — como este é um fake que devolve o que a resposta configurada tem independente do `.select()` pedido, a mudança de produção não muda o resultado deste teste específico. Este teste serve como documentação/regressão de forma (o shape que o resto do código espera), não como prova de que a query SQL pede essas colunas — para essa prova, confira visualmente a string do `.select(...)` depois de editá-la).

- [ ] **Step 6: Ligar `anexarFotosAssinadas` na server function**

Em `src/lib/crm/crm.functions.ts`, `listarConversasDoInbox`:

```typescript
export const listarConversasDoInbox = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .handler(async (): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarConversas } = await import("./conversas.server.ts");
    const { anexarFotosAssinadas } = await import("./fotos.ts");
    const linhas = await listarConversas(supabaseAdmin, 50);
    return anexarFotosAssinadas(supabaseAdmin, linhas);
  });
```

- [ ] **Step 7: UI — avatar e chips em `ListaConversas.tsx`**

No `<li>` de cada lead (por volta da linha 71), acrescente o avatar antes do título e os chips de máquina/anúncio na linha de metadados que já tem o estágio:

```tsx
                <div className="flex items-center gap-2">
                  {lead.foto_url ? (
                    <img src={lead.foto_url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-painel)] text-xs">
                      {(titulo?.[0] ?? "?").toUpperCase()}
                    </div>
                  )}
                  <span className="truncate font-medium">{titulo}</span>
                  {lead.precisa_atencao && <span title="Precisa de atenção">⚠️</span>}
                  {lead.nao_perturbe && <span title="Não perturbe">🔇</span>}
                  {lead.nao_lidas > 0 && (
                    <span className="ml-auto rounded-full bg-[var(--color-ia)] px-2 text-xs">
                      {lead.nao_lidas}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-[var(--color-suave)]">
                  {lead.ultima_mensagem_preview ?? "—"}
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-[var(--color-suave)]">
                  <span>{rotuloDeEstagio(lead.estagio ?? "")}</span>
                  <span>·</span>
                  <span>{assumida ? "você assumiu" : "IA respondendo"}</span>
                  {lead.maquina_interesse && (
                    <span className="rounded bg-[var(--color-painel)] px-1.5">{lead.maquina_interesse}</span>
                  )}
                  {lead.origem === "anuncio" && (
                    <span className="rounded bg-[var(--color-painel)] px-1.5">📣 {lead.ad_title || "Meta Ads"}</span>
                  )}
                  {lead.ultima_mensagem_em && (
                    <time className="ml-auto shrink-0" dateTime={lead.ultima_mensagem_em}>
                      {rotuloDeHorario(lead.ultima_mensagem_em)}
                    </time>
                  )}
                </div>
```

- [ ] **Step 8: Testar manualmente no navegador**

Suba o dev server (`bun run dev`), abra `/inbox`, confirme visualmente: leads com `foto_path` mostram avatar circular; leads sem foto mostram a inicial do título; leads com `maquina_interesse`/`origem === "anuncio"` mostram os chips; nada quebrou no layout existente (scroll, seleção da linha ativa).

- [ ] **Step 9: Suíte inteira + typecheck + build**

Run: `bun run test && bunx tsc --noEmit && bun run build`
Expected: baseline mantido nos três.

- [ ] **Step 10: Commit**

```bash
git add src/lib/crm/fotos.ts src/lib/crm/fotos.test.ts src/lib/crm/conversas.server.ts src/lib/crm/conversas.server.test.ts src/lib/crm/crm.functions.ts src/components/crm/ListaConversas.tsx
git commit -m "feat(inbox): avatar real do WhatsApp e tags derivadas (máquina, anúncio) na lista"
```

---

### Task 7: Horário por bolha e revisão final da branch

**Files:**
- Modify: `src/components/crm/Bolha.tsx`

**Interfaces:**
- Consumes: `rotuloDeHorario` (`src/components/crm/rotulos.ts`, já existe).

- [ ] **Step 1: Adicionar o horário na bolha**

Em `src/components/crm/Bolha.tsx`, importe `rotuloDeHorario` de `./rotulos` e, dentro do `<div>` que hoje só tem "Cliente"/"Mika"/"Você" (linha ~35), acrescente o horário ao lado:

```tsx
import { rotuloDeHorario } from "./rotulos";
```

```tsx
        <div className="mb-1 flex items-center gap-2 text-xs text-[var(--color-suave)]">
          <span>{mensagem.remetente === "lead" ? "Cliente" : mensagem.remetente === "ia" ? "Mika" : "Você"}</span>
          {mensagem.timestamp_ms && (
            <time dateTime={new Date(mensagem.timestamp_ms).toISOString()}>
              {rotuloDeHorario(new Date(mensagem.timestamp_ms).toISOString())}
            </time>
          )}
        </div>
```

- [ ] **Step 2: Testar manualmente no navegador**

Abra uma conversa com mensagens de hoje e (se houver) de dias anteriores — confirme que o horário aparece em cada bolha e seleciona corretamente hora/"ontem"/data, mesma regra já usada na lista.

- [ ] **Step 3: Suíte inteira + typecheck + build**

Run: `bun run test && bunx tsc --noEmit && bun run build`
Expected: baseline mantido nos três (este componente não tem teste próprio — `rotuloDeHorario` já é testado em `rotulos.test.ts`).

- [ ] **Step 4: Commit**

```bash
git add src/components/crm/Bolha.tsx
git commit -m "feat(inbox): horário de cada mensagem dentro da conversa"
```

- [ ] **Step 5: Revisão final da branch (dispatch de agente adversarial)**

Depois deste commit, dispatch um agente de revisão adversarial sobre TODA a Fatia 5 (desde o commit da Task 1 até aqui), no mesmo formato usado para fechar a Fatia 4 e a Fatia 6. Focos específicos desta fatia:

(a) **Vazamento de dado privado**: o bloco de payload/resposta CAPI no painel (Task 5) está mesmo atrás de `exigirSessao`? Alguma rota/componente novo expõe `foto_path` (o caminho do storage) em vez de só `foto_url` (a URL assinada) para o cliente?

(b) **URL de foto nunca crua**: confirme que em NENHUM lugar o código guarda ou devolve ao navegador a URL direta de `pps.whatsapp.net` — só o `foto_path` interno e a `foto_url` assinada de curta duração.

(c) **`sincronizarPerfil` nunca sobrescreve nome editado à mão**: releia o critério de `nomeEhPlaceholder` (Task 2) contra casos reais do banco (rode uma consulta comparando `leads.nome` atual dos leads reais contra o que passaria no critério) — algum nome legítimo seria classificado como placeholder por engano (falso positivo que apagaria edição manual)?

(d) **Custo de API**: confirme que um lead SEM foto no WhatsApp (perfil.image ausente) não gera uma tentativa de download/upload a cada mensagem — só a chamada a `/chat/details`, que por sua vez só acontece quando falta nome OU foto (curto-circuito da Task 3).

(e) Rode a suíte completa, `tsc --noEmit` e `bun run build` uma última vez — confirme os números finais batem com o que cada task reportou.

Classifique achados em Bloqueador/Importante/Menor com arquivo:linha. Corrija Bloqueadores diretamente (commit novo, nunca amend) se a correção for pequena e óbvia; senão, reporte para decisão do dono.
