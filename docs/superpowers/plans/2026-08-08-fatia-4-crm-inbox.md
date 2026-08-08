# Fatia 4 — CRM (login, inbox, painel do lead): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Pedro uma tela onde ele vê as conversas do WhatsApp, assume o atendimento no lugar da IA e edita o lead — em cima da camada de CRM que a Fatia 2 já deixou pronta.

**Architecture:** Três camadas. A de dados (`src/lib/crm/*.server.ts`) já existe e recebe um client `admin` por parâmetro — só ganha um módulo novo (`inbox.server.ts`) e um recheck de pausa no agente. A de exposição (`crm.functions.ts`, `auth.functions.ts`) são `createServerFn` finas que validam com zod, exigem sessão por middleware e delegam. A de tela são rotas TanStack com TanStack Query, que só conhecem as server functions.

**Tech Stack:** TanStack Start 1.168 + React 19, Supabase (`@supabase/ssr` novo nesta fatia), TanStack Query 5, Tailwind v4 (sem shadcn — ver Task 4), zod 3, runtime Bun. Testes com `node --test --experimental-strip-types`.

**Spec:** `docs/superpowers/specs/2026-08-08-fatia-4-crm-inbox-design.md`

## Global Constraints

- **Convenção `.server.ts`:** server-only, jamais importado no topo de um `.functions.ts`, de um `middleware.ts` ou de uma rota. Sempre `await import()` de dentro do handler. Violar isso é apontado no CPI como a fonte da maioria dos bugs.
- **Convenção `.functions.ts`:** vai para o bundle do cliente; só o corpo do handler é removido. Nada de `process.env`, client admin ou token da UAZAPI no topo.
- **Alias `@/` funciona no bundler** (`vite-tsconfig-paths`), mas **não** no `node --test`. Módulos com teste usam import relativo com extensão `.ts` explícita e não importam `@/...` no topo.
- **Toda `createServerFn` em `crm.functions.ts` leva `.middleware([registrarErros, exigirSessao])`.** As únicas exceções em todo o projeto são `entrar` e `sair`, em `auth.functions.ts`. O client é de service role e passa por cima do RLS — o middleware é a única fronteira.
- **Injeção de dependência para teste** segue o padrão existente (`DepsEnvio`, `DepsMoverEstagio`): parâmetro `deps` opcional, no fim da assinatura, nunca passado em produção.
- **Validação de entrada usa `.validator(...)`, nunca `.inputValidator(...)`.** Na versão instalada do TanStack Start (1.168.38) `inputValidator` ainda funciona, mas está marcado `@deprecated` nos tipos (`start-client-core/dist/esm/createServerFn.d.ts:81`) como alias de `validator`. O teste do invariante da Task 5 exige a forma nova.
- **Idioma:** nomes de arquivo, funções, variáveis e comentários em português, como todo o código existente.
- **Rodar a suíte inteira:** `bun run test` (que é `node --test --experimental-strip-types "src/**/*.test.ts"`).
- **Baseline do TypeScript:** `bunx tsc --noEmit` já reportava **7 erros antes desta fatia começar**, todos em arquivos de teste pré-existentes e nenhum em código de produção:
  - `src/lib/agente/prompt.test.ts` linhas 139, 144, 171, 172 — TS2345, `string | ParteDeConteudo[]`
  - `src/lib/capi/capi.server.test.ts` linha 125 — TS2345, `"QualifiedLead"`
  - `src/lib/crm/conversas.server.test.ts` linhas 182, 183 — TS18048, `'chamada' is possibly undefined`

  O critério em todas as tasks é **nenhum erro novo além destes sete**, não "zero erros". Corrigir os pré-existentes está fora do escopo desta fatia — se algum sumir por efeito colateral, ótimo, mas não é objetivo.
- **`src/routeTree.gen.ts` é gerado** pelo plugin do TanStack Router. Não editar à mão; ele muda sozinho ao criar rotas e entra nos commits.

---

### Task 1: Sessão do Supabase sobre cookie

**Files:**
- Create: `src/lib/auth/sessao.server.ts`
- Create: `src/lib/auth/sessao.test.ts`
- Modify: `package.json` (dependência `@supabase/ssr`)

**Interfaces:**
- Consumes: `criarFetchSupabase` de `src/integrations/supabase/client.ts` (já existe).
- Produces:
  - `type DepsSessao = { lerCookies?: () => Array<{name: string; value: string}>; gravarCookies?: (cookies: Array<{name: string; value: string; options?: any}>) => void; criarCliente?: (deps: ...) => any }`
  - `criarClienteDeSessao(deps?: DepsSessao): any`
  - `obterUsuario(deps?: DepsSessao): Promise<{ id: string; email?: string } | null>`

- [ ] **Step 1: Instalar a dependência**

```bash
bun add @supabase/ssr
```

- [ ] **Step 2: Escrever o teste que falha**

Cria `src/lib/auth/sessao.test.ts`. O teste injeta um client falso — nunca toca a rede nem o `@supabase/ssr` real:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { obterUsuario } from "./sessao.server.ts";

function clienteFalso(resposta: any) {
  return { auth: { getUser: async () => resposta } };
}

test("sem usuário na resposta do Supabase, não há sessão", async () => {
  const usuario = await obterUsuario({
    criarCliente: () => clienteFalso({ data: { user: null }, error: null }),
  });
  assert.equal(usuario, null);
});

test("token recusado pelo servidor não vira sessão", async () => {
  // getUser() valida contra o Supabase; um cookie forjado cai aqui, e é por
  // isso que este módulo não usa getSession(), que só decodifica o JWT local.
  const usuario = await obterUsuario({
    criarCliente: () => clienteFalso({ data: { user: null }, error: { message: "invalid JWT" } }),
  });
  assert.equal(usuario, null);
});

test("usuário válido volta como id e email", async () => {
  const usuario = await obterUsuario({
    criarCliente: () =>
      clienteFalso({ data: { user: { id: "u-1", email: "pedro@exemplo.com" } }, error: null }),
  });
  assert.deepEqual(usuario, { id: "u-1", email: "pedro@exemplo.com" });
});

test("usuário sem email não inventa string vazia", async () => {
  const usuario = await obterUsuario({
    criarCliente: () => clienteFalso({ data: { user: { id: "u-1", email: null } }, error: null }),
  });
  assert.deepEqual(usuario, { id: "u-1", email: undefined });
});

test("exceção do getUser não escapa — vira ausência de sessão", async () => {
  // Supabase fora do ar tem que virar 401, não stack trace no handler.
  const usuario = await obterUsuario({
    criarCliente: () => ({
      auth: {
        getUser: async () => {
          throw new Error("supabase fora do ar");
        },
      },
    }),
  });
  assert.equal(usuario, null);
});

test("com criarCliente injetado, nada do runtime do TanStack é tocado", async () => {
  // Se criarClienteDeSessao resolvesse os helpers de cookie antes de checar o
  // criarCliente injetado, este teste explodiria fora de um request.
  let chamou = false;
  await obterUsuario({
    criarCliente: () => {
      chamou = true;
      return clienteFalso({ data: { user: null }, error: null });
    },
  });
  assert.equal(chamou, true);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test --experimental-strip-types src/lib/auth/sessao.test.ts`
Expected: FAIL — `Cannot find module './sessao.server.ts'`

- [ ] **Step 4: Implementar**

Cria `src/lib/auth/sessao.server.ts`:

```ts
// Sessão do operador sobre cookie httpOnly. Server-only.
//
// Usa auth.getUser(), NUNCA auth.getSession(): o getSession só decodifica o JWT
// que veio no cookie, então um cookie forjado passaria. O getUser valida contra
// o servidor do Supabase. Como as server functions rodam com service role (que
// ignora o RLS), esta é a checagem que sustenta a autorização inteira do app.
import { createServerClient } from "@supabase/ssr";
import { criarFetchSupabase } from "../../integrations/supabase/client.ts";

export type CookieLido = { name: string; value: string };
export type CookieParaGravar = { name: string; value: string; options?: any };

export type DepsSessao = {
  /** Injetáveis só para teste. Em produção resolvem para os helpers do TanStack. */
  lerCookies?: () => CookieLido[];
  gravarCookies?: (cookies: CookieParaGravar[]) => void;
  criarCliente?: (deps: DepsSessao) => any;
};

/** Os helpers de cookie só existem dentro do request do TanStack, por isso são
 *  resolvidos por import dinâmico — e por isso criarClienteDeSessao é async. */
async function helpersDoPedido() {
  const { getCookies, setCookie } = await import("@tanstack/react-start/server");
  return {
    lerCookies: (): CookieLido[] =>
      Object.entries(getCookies() ?? {}).map(([name, value]) => ({ name, value: String(value) })),
    gravarCookies: (cookies: CookieParaGravar[]) => {
      for (const { name, value, options } of cookies) setCookie(name, value, options);
    },
  };
}

function criarClientePadrao(deps: Required<Pick<DepsSessao, "lerCookies" | "gravarCookies">>) {
  const url = process.env.SUPABASE_URL ?? "";
  const chave = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !chave) {
    throw new Error("Sessão não configurada: defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY");
  }
  return createServerClient(url, chave, {
    // Mesmo tratamento das chaves novas (sb_publishable_) usado nos outros
    // clients: elas não são JWT e o PostgREST rejeita se forem no Authorization.
    global: { fetch: criarFetchSupabase(chave) },
    cookies: {
      getAll: () => deps.lerCookies(),
      setAll: (cookies: CookieParaGravar[]) => deps.gravarCookies(cookies),
    },
  });
}

/** Client ligado aos cookies do request atual. Use dentro de um handler. */
export async function criarClienteDeSessao(deps: DepsSessao = {}): Promise<any> {
  // O client injetado vem primeiro, e nada do runtime do TanStack é tocado —
  // é o que permite testar este módulo sob node --test, fora de um request.
  if (deps.criarCliente) return deps.criarCliente(deps);

  const doPedido = await helpersDoPedido();
  return criarClientePadrao({
    lerCookies: deps.lerCookies ?? doPedido.lerCookies,
    gravarCookies: deps.gravarCookies ?? doPedido.gravarCookies,
  });
}

/**
 * Usuário logado, ou null. Nunca lança: uma falha de rede com o Supabase vira
 * "não autenticado", que o middleware traduz em 401 — melhor recusar do que
 * derrubar o handler com stack trace.
 */
export async function obterUsuario(
  deps: DepsSessao = {},
): Promise<{ id: string; email?: string } | null> {
  try {
    const cliente = await criarClienteDeSessao(deps);
    const { data, error } = await cliente.auth.getUser();
    if (error || !data?.user) return null;
    return { id: data.user.id, email: data.user.email ?? undefined };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test --experimental-strip-types src/lib/auth/sessao.test.ts`
Expected: PASS, 6 testes

- [ ] **Step 6: Registrar a variável de ambiente**

Em `.env.example`, acrescenta abaixo das outras chaves do Supabase:

```
# Chave publicável, usada pela sessão do operador (login do CRM).
SUPABASE_PUBLISHABLE_KEY=
```

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock .env.example src/lib/auth/sessao.server.ts src/lib/auth/sessao.test.ts
git commit -m "feat(auth): sessão do operador sobre cookie, validada por getUser"
```

---

### Task 2: Middlewares de autorização

**Files:**
- Create: `src/lib/auth/middleware.ts`
- Test: coberto pelo invariante da Task 5 (não há lógica testável isolada aqui)

**Interfaces:**
- Consumes: `obterUsuario` de `src/lib/auth/sessao.server.ts` (Task 1), via `await import()`.
- Produces: `exigirSessao` e `registrarErros`, middlewares de `createMiddleware({ type: "function" })`. `exigirSessao` injeta `context.usuario: { id: string; email?: string }`.

- [ ] **Step 1: Implementar**

⚠️ O arquivo é `middleware.ts`, **não** `middleware.server.ts`: middlewares são referenciados fora do handler, no encadeamento `.middleware([...])`, então o módulo entra no bundle do cliente — só o corpo do `.server()` é removido. Por isso `sessao.server.ts` entra por `await import()`.

```ts
// Middlewares das server functions. Vai ao bundle do cliente (só o corpo do
// .server() é removido) — nada server-only no topo.
import { createMiddleware } from "@tanstack/react-start";

/**
 * A fronteira de segurança do app inteiro.
 *
 * As server functions usam o client de service role, que ignora o RLS. Uma
 * função sem este middleware é um endpoint público de escrita no banco — há um
 * teste em crm.functions.test.ts que falha se alguma esquecer.
 */
export const exigirSessao = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { obterUsuario } = await import("./sessao.server.ts");
  const usuario = await obterUsuario();
  if (!usuario) {
    throw new Response("nao_autenticado", { status: 401 });
  }
  return next({ context: { usuario } });
});

/** Equivalente ao logServerFnErrors do CPI: erro não some no console do browser. */
export const registrarErros = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (err: any) {
    // Response é fluxo normal (401, redirect) — não é erro para logar.
    if (!(err instanceof Response)) {
      console.error("[serverFn]", err?.message ?? err);
    }
    throw err;
  }
});
```

- [ ] **Step 2: Verificar que o TypeScript aceita**

Run: `bunx tsc --noEmit`
Expected: sem erro apontando para `src/lib/auth/middleware.ts`

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/middleware.ts
git commit -m "feat(auth): middlewares exigirSessao e registrarErros"
```

---

### Task 3: Login — server functions e tela

**Files:**
- Create: `src/lib/auth/auth.functions.ts`
- Create: `src/lib/auth/destino.ts`
- Create: `src/lib/auth/destino.test.ts`
- Create: `src/routes/login.tsx`
- Modify: `src/routeTree.gen.ts` (gerado automaticamente)

**Interfaces:**
- Consumes: `criarClienteDeSessao` de `sessao.server.ts` (Task 1); `registrarErros` de `middleware.ts` (Task 2).
- Produces:
  - `entrar({ data: { email: string; senha: string } }): Promise<{ ok: boolean; erro?: string }>`
  - `sair(): Promise<{ ok: true }>`
  - `destinoSeguro(bruto: unknown): string` em `destino.ts` — **a Task 4 também precisa dele**, porque o `beforeLoad` do `_app` monta o `?destino=` que esta tela consome.

- [ ] **Step 1: Escrever as server functions**

Cria `src/lib/auth/auth.functions.ts`:

```ts
// As DUAS únicas server functions sem exigirSessao no projeto — são elas que
// criam a sessão. O teste do invariante em crm.functions.test.ts as conhece
// nominalmente como exceções.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { registrarErros } from "./middleware.ts";

const entradaLogin = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

export const entrar = createServerFn({ method: "POST" })
  .middleware([registrarErros])
  .validator((dados: unknown) => entradaLogin.parse(dados))
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { criarClienteDeSessao } = await import("./sessao.server.ts");
    const cliente = await criarClienteDeSessao();
    const { error } = await cliente.auth.signInWithPassword({
      email: data.email,
      password: data.senha,
    });
    // Mensagem genérica de propósito: dizer qual campo errou entrega ao
    // atacante a informação de que aquele e-mail existe.
    if (error) return { ok: false, erro: "E-mail ou senha inválidos." };
    return { ok: true };
  });

export const sair = createServerFn({ method: "POST" })
  .middleware([registrarErros])
  .handler(async (): Promise<{ ok: true }> => {
    const { criarClienteDeSessao } = await import("./sessao.server.ts");
    const cliente = await criarClienteDeSessao();
    await cliente.auth.signOut();
    return { ok: true };
  });
```

- [ ] **Step 2a: Validar o destino pós-login (TDD)**

`?destino=` vem da URL, ou seja, de quem mandar o link. Sem checagem, `//evil.com` é resolvido pelo navegador contra a origem atual e vira `https://evil.com` — a vítima faz login de verdade e é levada para fora, parecendo que o app a mandou. Barrar `//` e `/\` é o que separa caminho interno de URL protocol-relative.

Fica em módulo próprio, e não dentro de `login.tsx`, porque rota não é testável sob `node --test` (alias `@/` e JSX). Escreva o teste primeiro.

Cria `src/lib/auth/destino.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinoSeguro } from "./destino.ts";

test("caminho interno normal passa", () => {
  assert.equal(destinoSeguro("/inbox"), "/inbox");
  assert.equal(destinoSeguro("/inbox/abc?leadId=1"), "/inbox/abc?leadId=1");
});

test("URL protocol-relative é recusada — este é o ataque", () => {
  // O navegador resolveria //evil.com contra a origem atual.
  assert.equal(destinoSeguro("//evil.com"), "/inbox");
});

test("variante com barra invertida é recusada", () => {
  assert.equal(destinoSeguro("/\\evil.com"), "/inbox");
});

test("URL absoluta é recusada", () => {
  assert.equal(destinoSeguro("https://evil.com"), "/inbox");
});

test("caminho sem barra inicial é recusado", () => {
  assert.equal(destinoSeguro("inbox"), "/inbox");
});

test("o que não é string vira o padrão", () => {
  assert.equal(destinoSeguro(undefined), "/inbox");
  assert.equal(destinoSeguro(123), "/inbox");
});

test("tab, CR e LF não driblam a checagem", () => {
  // A spec WHATWG REMOVE tab/CR/LF antes de parsear, então "/\t/evil.com"
  // vira https://evil.com/ no navegador — passando por qualquer guarda que
  // olhe só o prefixo literal. Chegam aqui como %09/%0A/%0D no ?destino=.
  assert.equal(destinoSeguro("/\t/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\n/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\r/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\r\n/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\t\t//evil.com"), "/inbox");
});

test("dot-segment não reconstrói caminho protocol-relative na saída", () => {
  // "/.//evil.com" resolve com a origem CERTA (a base sentinela), mas a
  // remoção de dot-segments deixa o pathname "//evil.com" — que, relido por
  // qualquer navegação, vira https://evil.com. Validar só a entrada não
  // basta: a saída também precisa passar pelo mesmo teste.
  assert.equal(destinoSeguro("/.//evil.com"), "/inbox");
  assert.equal(destinoSeguro("/././/evil.com"), "/inbox");
  assert.equal(destinoSeguro("/x/..//evil.com"), "/inbox");
  assert.equal(destinoSeguro("/.///evil.com"), "/inbox");
  assert.equal(destinoSeguro("/a/../..//evil.com"), "/inbox");
  assert.equal(destinoSeguro("/\t.//evil.com"), "/inbox");
});

test("caminhos internos legítimos atravessam intactos", () => {
  // O outro lado do risco: normalização agressiva demais quebraria o retorno
  // pós-login, que é a razão de o ?destino= existir.
  assert.equal(destinoSeguro("/inbox/"), "/inbox/");
  assert.equal(destinoSeguro("/tarefas"), "/tarefas");
  assert.equal(destinoSeguro("/inbox/x#topo"), "/inbox/x#topo");
  assert.equal(destinoSeguro("/inbox/a/b?q=1&r=2"), "/inbox/a/b?q=1&r=2");
});
```

Rode (`node --test --experimental-strip-types src/lib/auth/destino.test.ts`), veja falhar por módulo inexistente, e só então crie `src/lib/auth/destino.ts`:

```ts
// Puro: sem React, sem alias, testável sob node --test.

/** Base sentinela para resolver o candidato. `.invalid` é TLD reservado
 *  (RFC 2606), então não há host real com que colidir. */
const BASE_SENTINELA = "https://base.invalid";
const DESTINO_PADRAO = "/inbox";

/**
 * Resolve contra a base sentinela e devolve o caminho normalizado, ou null se
 * a resolução saiu da origem — isto é, se a string era URL disfarçada.
 */
function resolverInterno(valor: string): string | null {
  let url: URL;
  try {
    url = new URL(valor, BASE_SENTINELA);
  } catch {
    return null;
  }
  if (url.origin !== BASE_SENTINELA) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Só aceita caminho interno como destino pós-login.
 *
 * A decisão é delegada ao MESMO parser de URL que o navegador usa, em vez de
 * comparar prefixos: a spec WHATWG remove tab, CR e LF antes de parsear, de
 * modo que "/\t/evil.com" vira https://evil.com/ e engana qualquer checagem
 * de `startsWith`.
 *
 * Mas resolver uma vez não basta, e é aqui que a versão anterior falhava:
 * "/.//evil.com" resolve COM a origem certa (a sentinela) e mesmo assim
 * produz o pathname "//evil.com" — protocol-relative de novo, agora fabricado
 * pela própria remoção de dot-segments. Por isso a saída passa pelo mesmo
 * teste da entrada: só é aceita se resolver para si mesma. Exigir esse ponto
 * fixo é o que fecha a classe, em vez de caçar padrão por padrão.
 */
export function destinoSeguro(bruto: unknown): string {
  if (typeof bruto !== "string") return DESTINO_PADRAO;
  if (!bruto.startsWith("/")) return DESTINO_PADRAO;

  const caminho = resolverInterno(bruto);
  if (caminho === null) return DESTINO_PADRAO;

  // Ponto fixo: se resolver o resultado der outra coisa, a normalização
  // fabricou algo que a primeira passagem não viu.
  if (resolverInterno(caminho) !== caminho) return DESTINO_PADRAO;

  return caminho;
}
```

- [ ] **Step 2b: Escrever a tela de login**

Cria `src/routes/login.tsx`. Estilização mínima — a base do Tailwind chega na Task 4; aqui o objetivo é o fluxo funcionar:

```tsx
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { entrar } from "@/lib/auth/auth.functions";
import { destinoSeguro } from "@/lib/auth/destino";

export const Route = createFileRoute("/login")({
  validateSearch: (busca: Record<string, unknown>) => ({
    destino: destinoSeguro(busca.destino),
  }),
  component: TelaLogin,
});

function TelaLogin() {
  const navegar = useNavigate();
  const { destino } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    const resultado = await entrar({ data: { email, senha } });
    setEnviando(false);
    if (!resultado.ok) {
      setErro(resultado.erro ?? "Não foi possível entrar.");
      return;
    }
    navegar({ to: destino });
  }

  return (
    <main style={{ maxWidth: 320, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>TON CRM</h1>
      <form onSubmit={submeter}>
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
            style={{ width: "100%" }}
          />
        </label>
        {erro && <p role="alert">{erro}</p>}
        <button type="submit" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Criar o usuário no Supabase**

No painel do projeto Supabase: **Authentication → Users → Add user**, com e-mail e senha do Pedro, marcando "Auto Confirm User".

Em seguida, **Authentication → Sign In / Providers → Email**: desligar **"Enable signups"**. Sem isso, `/auth/v1/signup` fica aberto e qualquer pessoa cria uma conta que o `eh_dono()` aceita — ele só verifica `auth.uid() is not null`, não *qual* usuário.

- [ ] **Step 4: Verificar manualmente**

Run: `bun run dev`

1. Abrir `http://localhost:3000/login`.
2. Enviar e-mail ou senha errada → aparece "E-mail ou senha inválidos.".
3. Enviar as credenciais corretas → navega para `/inbox` (a rota ainda não existe; um 404 do router aqui é o resultado esperado nesta task).
4. Nas DevTools → Application → Cookies, confirmar que existem cookies `sb-…` marcados **HttpOnly**.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/auth.functions.ts src/lib/auth/destino.ts src/lib/auth/destino.test.ts \
  src/routes/login.tsx src/routeTree.gen.ts
git commit -m "feat(auth): tela de login e server functions entrar/sair"
```

---

### Task 4: Casca autenticada — Tailwind e rota protegida

**Files:**
- Create: `src/styles.css`
- Create: `src/routes/_app.tsx`
- Create: `src/routes/_app/inbox.tsx` (placeholder nesta task)
- Modify: `src/routes/__root.tsx`
- Modify: `vite.config.ts`
- Modify: `src/routeTree.gen.ts` (gerado)

**Interfaces:**
- Consumes: `obterUsuario` via uma server function nova `obterSessaoAtual` (definida aqui, em `auth.functions.ts`).
- Produces:
  - `obterSessaoAtual(): Promise<{ id: string; email?: string } | null>` em `auth.functions.ts`
  - Rota `_app` como layout de toda tela autenticada; qualquer rota nova do CRM nasce como `src/routes/_app/*.tsx`.

- [ ] **Step 1: Instalar Tailwind v4 e o cliente de query**

```bash
bun add tailwindcss @tailwindcss/vite @tanstack/react-query
```

- [ ] **Step 2: Ligar o Tailwind ao Vite**

Em `vite.config.ts`, importar e acrescentar o plugin — ele vem **antes** de `tanstackStart()`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tsConfigPaths(), tailwindcss(), tanstackStart(), react()],
  server: {
    port: 3000,
  },
});
```

- [ ] **Step 3: Criar a folha de estilo**

Cria `src/styles.css`:

```css
@import "tailwindcss";

@theme {
  --color-fundo: #0b0f14;
  --color-painel: #131a22;
  --color-borda: #22303c;
  --color-texto: #e6edf3;
  --color-suave: #8b98a5;
  --color-lead: #1f2c37;
  --color-ia: #1d3b53;
  --color-humano: #14532d;
  --color-alerta: #7f1d1d;
}

body {
  background: var(--color-fundo);
  color: var(--color-texto);
}
```

As três cores de bolha (`--color-lead`, `--color-ia`, `--color-humano`) são requisito do spec: distinguir IA de humano de relance evita repetir ou contradizer o que a IA já disse.

- [ ] **Step 4: Carregar o CSS e o QueryClient no root**

Substitui `src/routes/__root.tsx`:

```tsx
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import estilos from "../styles.css?url";

function criarClienteQuery() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // O inbox é o único consumidor e define o próprio refetchInterval.
        // Sem retry infinito: um 401 tem que chegar rápido na tela.
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TON-CRM-IA" },
    ],
    links: [{ rel: "stylesheet", href: estilos }],
  }),
  component: RootComponent,
});

function RootComponent() {
  // Dentro do componente, não no topo do módulo: o servidor é um processo Node
  // persistente, então um client de módulo seria UM cache para todos os
  // requests — o SSR de um usuário passaria a enxergar dados cacheados no
  // request de outro. O useState com inicializador cria um por render de
  // servidor e mantém o mesmo no cliente entre renders.
  const [clienteQuery] = useState(criarClienteQuery);

  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <QueryClientProvider client={clienteQuery}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Acrescentar `obterSessaoAtual` às server functions de auth**

Em `src/lib/auth/auth.functions.ts`, adiciona ao final:

```ts
/** Usada pelo beforeLoad do layout _app. Devolve null em vez de 401 — quem
 *  decide o redirect é a rota, não o middleware. */
export const obterSessaoAtual = createServerFn({ method: "GET" })
  .middleware([registrarErros])
  .handler(async (): Promise<{ id: string; email?: string } | null> => {
    const { obterUsuario } = await import("./sessao.server.ts");
    return obterUsuario();
  });
```

Esta é a terceira e última função sem `exigirSessao` — atualize a lista de exceções na Task 5 se implementar fora de ordem.

- [ ] **Step 6: Criar o layout autenticado**

⚠️ **Restrição herdada da Task 3, apurada no re-review.** O `destino` só pode ser consumido pela navegação do próprio TanStack Router (`redirect({ to })`, `navegar({ to })`, `<Link to>`). Nunca por `window.location`, por um `<a href>` montado à mão, ou por qualquer código que faça `decodeURIComponent` no caminho antes de resolver.

O motivo é específico: `destinoSeguro` aceita `/%2F%2Fevil.com` como caminho interno, e isso está correto — é um segmento percent-encoded. O router decodifica esse valor internamente (`router-core` → `decodePath`), mas logo em seguida colapsa `//` inicial para `/`, o que neutraliza o resultado. Essa proteção é do TanStack, não do `destinoSeguro`: o ponto fixo fecha "reparse muda a origem", e não tem como fechar "decodifica e depois compara prefixo". Um caminho de navegação que decodifique sem colapsar reabre o open redirect.

Cria `src/routes/_app.tsx`:

```tsx
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { obterSessaoAtual, sair } from "@/lib/auth/auth.functions";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const usuario = await obterSessaoAtual();
    if (!usuario) {
      throw redirect({ to: "/login", search: { destino: location.href } });
    }
    return { usuario };
  },
  component: LayoutApp,
});

function LayoutApp() {
  const navegar = useNavigate();

  async function encerrar() {
    await sair();
    navegar({ to: "/login", search: { destino: "/inbox" } });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--color-borda)] px-4 py-2">
        <strong>TON CRM</strong>
        <Link to="/inbox" className="text-[var(--color-suave)] hover:text-[var(--color-texto)]">
          Conversas
        </Link>
        <button onClick={encerrar} className="ml-auto text-[var(--color-suave)]">
          Sair
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
```

Toda rota do CRM nasce dentro de `src/routes/_app/`, então nenhuma tela fica desprotegida por esquecimento.

- [ ] **Step 7: Criar o inbox placeholder**

Cria `src/routes/_app/inbox.tsx`:

```tsx
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/inbox")({
  component: LayoutInbox,
});

function LayoutInbox() {
  return (
    <div className="grid h-full grid-cols-[340px_1fr]">
      <aside className="overflow-y-auto border-r border-[var(--color-borda)]">
        <p className="p-4 text-[var(--color-suave)]">Lista de conversas (Task 6)</p>
      </aside>
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
```

- [ ] **Step 8: Verificar manualmente**

Run: `bun run dev`

1. Abrir `http://localhost:3000/inbox` **sem** estar logado → redireciona para `/login?destino=/inbox`.
2. Entrar → volta para `/inbox` e mostra a casca com o cabeçalho e a coluna vazia.
3. Clicar em "Sair" → volta ao login; reabrir `/inbox` redireciona de novo.

- [ ] **Step 9: Commit**

```bash
git add package.json bun.lock vite.config.ts src/styles.css \
  src/routes/__root.tsx src/routes/_app.tsx src/routes/_app/inbox.tsx \
  src/lib/auth/auth.functions.ts src/components src/routeTree.gen.ts
git commit -m "feat(crm): casca autenticada com Tailwind e rota _app"
```

---

### Task 5: Server functions de leitura e o teste do invariante

**Files:**
- Create: `src/lib/crm/crm.functions.ts`
- Create: `src/lib/crm/crm.functions.test.ts`

**Interfaces:**
- Consumes: `listarConversas`, `listarMensagens` de `conversas.server.ts`/`mensagens.server.ts`; `obterLead` de `leads.server.ts`; `listarTarefas` de `tarefas.server.ts`; `supabaseAdmin` de `@/integrations/supabase/client.server`; `exigirSessao`/`registrarErros` da Task 2.
- Produces:
  - `listarConversasDoInbox(): Promise<any[]>`
  - `listarMensagensDaConversa({ data: { conversaId: string } }): Promise<any[]>`
  - `obterLeadDoCrm({ data: { leadId: string } }): Promise<any | null>`
  - `listarTarefasDoCrm({ data: { apenasAbertas: boolean } }): Promise<any[]>`
  - `obterUrlDeMidia({ data: { mensagemId: string } }): Promise<{ url: string | null }>`

- [ ] **Step 1: Escrever o teste do invariante (falha por falta do arquivo)**

Este é o teste de maior retorno da fatia: ele lê o próprio código-fonte e falha se alguma server function esquecer o middleware. Cria `src/lib/crm/crm.functions.test.ts`:

Três propriedades decidem se este teste vale alguma coisa, e todas são sobre **falso negativo** — um teste verde que não olhou nada é pior que teste nenhum, porque produz confiança sem proteção:

1. **Descobre os arquivos, não os lista.** Caminhos fixos deixariam um `pedidos.functions.ts` futuro nascer fora da varredura, com o teste seguindo verde.
2. **Ignora comentários.** Comentar a linha do `.middleware` é a forma mais comum de desativar algo "só pra debugar"; se isso passa, o guarda não guarda.
3. **Recusa declaração que não reconhece.** O buraco mais perigoso não é uma função sem `exigirSessao` — é uma que o regex não enxerga e por isso nunca verifica. Contar os `createServerFn` crus e exigir que batam com os nomeados transforma "formato desconhecido" em falha, em vez de silêncio.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// As server functions dependem do runtime do TanStack e não são importáveis
// aqui. O que importa verificar é estrutural, e o código-fonte basta.

const DIR_SRC = fileURLToPath(new URL("../../", import.meta.url));
const SEM_SESSAO_PERMITIDAS = ["entrar", "sair", "obterSessaoAtual"];

/** Todo *.functions.ts sob src/ — arquivo novo nasce coberto. */
function acharFunctions(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) achados.push(...acharFunctions(caminho));
    else if (entrada.name.endsWith(".functions.ts")) achados.push(caminho);
  }
  return achados;
}

/** O `[^:]` antes de `//` evita mutilar "https://..." dentro de string. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const ARQUIVOS = acharFunctions(DIR_SRC).map((caminho) => ({
  nome: caminho.split(/[\\/]/).pop()!,
  fonte: semComentarios(readFileSync(caminho, "utf8")),
}));

/** Aceita anotação de tipo e genérico: `export const X: T = createServerFn<U>(`. */
function nomesDeServerFn(fonte: string): string[] {
  const re = /export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*createServerFn\s*(?:<[^>]*>)?\s*\(/g;
  const nomes: string[] = [];
  let achado: RegExpExecArray | null;
  while ((achado = re.exec(fonte))) nomes.push(achado[1]);
  return nomes;
}

function corpoDaDeclaracao(fonte: string, nome: string): string {
  const inicio = fonte.search(new RegExp(`export\\s+const\\s+${nome}\\b`));
  assert.notEqual(inicio, -1, `não achei a declaração de ${nome}`);
  const resto = fonte.slice(inicio + 1);
  const proximo = resto.search(/export\s+const\s+\w+/);
  return proximo === -1 ? fonte.slice(inicio) : fonte.slice(inicio, inicio + 1 + proximo);
}

test("a varredura acha os arquivos de server functions", () => {
  // Se a descoberta quebrar, os testes abaixo passariam vazios.
  assert.ok(ARQUIVOS.length >= 2, "esperava ao menos auth.functions.ts e crm.functions.ts");
  assert.ok(ARQUIVOS.some((a) => a.nome === "auth.functions.ts"));
  assert.ok(ARQUIVOS.some((a) => a.nome === "crm.functions.ts"));
});

test("nenhuma declaração de createServerFn escapa do reconhecimento", () => {
  for (const { nome, fonte } of ARQUIVOS) {
    const brutas = (fonte.match(/createServerFn\s*(?:<[^>]*>)?\s*\(/g) ?? []).length;
    assert.equal(
      nomesDeServerFn(fonte).length,
      brutas,
      `${nome}: o arquivo tem ${brutas} createServerFn, mas o regex nomeou outra ` +
        "quantidade — há declaração num formato que este teste não verifica",
    );
  }
});

test("TODA server function exige sessão, exceto as três de auth", () => {
  // O client é de service role e ignora o RLS: uma função sem exigirSessao é
  // um endpoint público no banco.
  const semSessao: string[] = [];
  for (const { fonte } of ARQUIVOS) {
    for (const nome of nomesDeServerFn(fonte)) {
      const corpo = corpoDaDeclaracao(fonte, nome);
      if (!/\.middleware\(\[[^\]]*\bexigirSessao\b[^\]]*\]\)/.test(corpo)) semSessao.push(nome);
    }
  }
  assert.deepEqual(semSessao.sort(), [...SEM_SESSAO_PERMITIDAS].sort());
});

test("toda server function valida a entrada ou não recebe nenhuma", () => {
  for (const { fonte } of ARQUIVOS) {
    for (const nome of nomesDeServerFn(fonte)) {
      const corpo = corpoDaDeclaracao(fonte, nome);
      // Conta as duas formas de ler a entrada: desestruturando `{ data }` ou
      // pegando o contexto inteiro e acessando `ctx.data`.
      const desestrutura = /handler\(\s*(?:async\s*)?\(\s*\{\s*data\b/.test(corpo);
      const viaContexto = /handler\(\s*(?:async\s*)?\(\s*(\w+)[^)]*\)[^=]*=>[\s\S]*?\b\1\.data\b/.test(corpo);
      if (desestrutura || viaContexto) {
        // `.validator(` e não `.inputValidator(`: este último é alias
        // @deprecated na versão instalada do TanStack Start, e o regex recusá-lo
        // é o que impede a API antiga de voltar sem ninguém notar.
        assert.ok(
          /\.validator\(/.test(corpo),
          `${nome} lê data sem validator — entrada não validada`,
        );
      }
    }
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --experimental-strip-types src/lib/crm/crm.functions.test.ts`
Expected: FAIL — `ENOENT` ao ler `crm.functions.ts`

- [ ] **Step 3: Implementar as funções de leitura**

Cria `src/lib/crm/crm.functions.ts`:

```ts
// Camada de exposição do CRM. Cada função é fina: valida, exige sessão,
// importa o .server.ts dentro do handler e delega. Nenhuma regra de negócio
// nasce aqui — ela mora nos .server.ts, que a Fatia 2 já deixou prontos.
//
// ATENÇÃO: este arquivo vai para o bundle do cliente (só o corpo do handler é
// removido). Nada server-only no topo.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { exigirSessao, registrarErros } from "../auth/middleware.ts";

const porConversa = z.object({ conversaId: z.string().uuid() });
const porLead = z.object({ leadId: z.string().uuid() });
const porMensagem = z.object({ mensagemId: z.string().uuid() });

export const listarConversasDoInbox = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .handler(async (): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarConversas } = await import("./conversas.server.ts");
    return listarConversas(supabaseAdmin, 50);
  });

export const listarMensagensDaConversa = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        conversaId: z.string().uuid(),
        // Teto de 500: o "carregar mais antigas" da tela sobe de 50 em 50, e
        // um limite aberto vindo do cliente puxaria a conversa inteira.
        limite: z.number().int().min(1).max(500).default(50),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarMensagens } = await import("./mensagens.server.ts");
    return listarMensagens(supabaseAdmin, data.conversaId, data.limite);
  });

export const obterLeadDoCrm = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<any | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { obterLead } = await import("./leads.server.ts");
    return obterLead(supabaseAdmin, data.leadId);
  });

export const listarTarefasDoCrm = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ apenasAbertas: z.boolean().default(true), leadId: z.string().uuid().optional() }).parse(dados),
  )
  .handler(async ({ data }): Promise<any[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listarTarefas } = await import("./tarefas.server.ts");
    return listarTarefas(supabaseAdmin, {
      leadId: data.leadId,
      concluida: data.apenasAbertas ? false : undefined,
    });
  });

/**
 * URL assinada de 5 minutos para o bucket privado crm-midia.
 *
 * Recebe o ID da mensagem, nunca o caminho: o handler roda com service role, e
 * aceitar media_path vindo do navegador seria leitura arbitrária do bucket.
 */
export const obterUrlDeMidia = createServerFn({ method: "GET" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porMensagem.parse(dados))
  .handler(async ({ data }): Promise<{ url: string | null }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: mensagem } = await supabaseAdmin
      .from("mensagens")
      .select("media_path")
      .eq("id", data.mensagemId)
      .maybeSingle();
    if (!mensagem?.media_path) return { url: null };

    const { data: assinada } = await supabaseAdmin.storage
      .from("crm-midia")
      .createSignedUrl(mensagem.media_path, 300);
    return { url: assinada?.signedUrl ?? null };
  });
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --experimental-strip-types src/lib/crm/crm.functions.test.ts`
Expected: PASS, 4 testes

- [ ] **Step 5: Provar que o invariante realmente pega o erro**

Um teste de invariante que nunca se viu falhar não vale nada. São **três** sabotagens, uma de cada vez, desfazendo entre elas e confirmando que volta a PASS:

**5a — remover.** Tira `exigirSessao` do encadeamento de `obterLeadDoCrm`.
Expected: FAIL em "TODA server function exige sessão", com `obterLeadDoCrm` na lista de sem-sessão.

**5b — comentar.** Restaura, e agora comenta a linha inteira do `.middleware([...])` de `obterLeadDoCrm` com `//`.
Expected: FAIL do mesmo teste. Este é o cenário que a primeira versão do teste deixava passar — comentar é o jeito mais comum de desativar algo "só pra debugar".

**5c — declarar em formato não reconhecido.** Restaura, e troca uma declaração para a forma `const x = createServerFn(...)` seguida de `export { x }`.
Expected: FAIL em "nenhuma declaração de createServerFn escapa do reconhecimento", dizendo que o arquivo tem N `createServerFn` e o regex nomeou outra quantidade. Este é o falso negativo mais perigoso: sem essa contagem, a função simplesmente não seria verificada e o teste seguiria verde.

Restaura tudo ao fim e confirma a suíte limpa. Registre no relatório a mensagem exata das três falhas.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crm/crm.functions.ts src/lib/crm/crm.functions.test.ts
git commit -m "feat(crm): server functions de leitura e teste do invariante de autorização"
```

---

### Task 6: `responderComoHumano` — o núcleo da resposta manual

**Files:**
- Create: `src/lib/crm/inbox.server.ts`
- Create: `src/lib/crm/inbox.server.test.ts`
- Modify: `src/lib/crm/mensagens.server.ts:1-2` (comentário desatualizado)

**Interfaces:**
- Consumes: `pausarIa`, `marcarLida` de `conversas.server.ts`; `enviarTextoDoCrm` de `mensagens.server.ts`.
- Produces:
  - `type DepsResposta = { enviar?: (numero: string, texto: string) => Promise<any> }`
  - `responderComoHumano(admin, { conversaId, leadId, texto }, deps?): Promise<{ ok: boolean; erro?: string }>`

A lógica mora aqui, e não na server function, por dois motivos: ela tem ordem que importa (pausar antes de enviar) e regra de segurança (telefone lido do banco), e o `.server.ts` é testável sem o runtime do TanStack.

- [ ] **Step 1: Escrever o teste que falha**

Cria `src/lib/crm/inbox.server.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { responderComoHumano } from "./inbox.server.ts";

/**
 * Dublê mínimo do client do Supabase, registrando a ordem das operações.
 * `leads` e `conversas` respondem a update; `mensagens` responde a insert e
 * update, como enviarTextoDoCrm espera.
 */
function adminFalso(
  opcoes: { telefone?: string | null; leadExiste?: boolean; erroNoLead?: string } = {},
) {
  const ordem: string[] = [];
  const telefone = opcoes.telefone === undefined ? "5511999999999" : opcoes.telefone;
  const leadExiste = opcoes.leadExiste !== false;

  const admin: any = {
    ordem,
    from(tabela: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => {
          ordem.push(`select:${tabela}`);
          if (tabela !== "leads") return { data: {}, error: null };
          // O dublê precisa saber devolver lead ausente e erro de banco: são
          // dois caminhos distintos do código, e sem isso ficariam sem teste.
          if (opcoes.erroNoLead) return { data: null, error: { message: opcoes.erroNoLead } };
          return { data: leadExiste ? { id: "lead-1", telefone } : null, error: null };
        },
        single: async () => {
          ordem.push(`insert:${tabela}`);
          return { data: { id: "msg-1" }, error: null };
        },
        insert() {
          return this;
        },
        update(campos: Record<string, unknown>) {
          ordem.push(`update:${tabela}:${Object.keys(campos).join(",")}`);
          return this;
        },
      };
    },
  };
  return admin;
}

test("pausa a IA antes de enviar", async () => {
  const admin = adminFalso();
  const enviados: string[] = [];

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi, aqui é o Pedro" },
    {
      enviar: async (_numero, texto) => {
        admin.ordem.push("envio");
        enviados.push(texto);
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(resultado.ok, true);
  const posPausa = admin.ordem.findIndex((p: string) => p.startsWith("update:conversas:pausada_pela_ia"));
  const posEnvio = admin.ordem.indexOf("envio");
  assert.ok(posPausa !== -1, "não pausou a IA");
  // Na ordem inversa, um worker acordando no meio entregaria a resposta da IA
  // logo depois da humana, possivelmente se contradizendo.
  assert.ok(posPausa < posEnvio, "pausou depois de enviar");
});

test("usa o telefone do banco, ignorando o que vier de fora", async () => {
  const admin = adminFalso({ telefone: "5511888888888" });
  let numeroUsado = "";

  await responderComoHumano(
    admin,
    // O tipo não aceita telefone; este teste garante que, mesmo que alguém
    // acrescente o campo depois, o valor do banco continua ganhando.
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi", telefone: "5511000000000" } as any,
    {
      enviar: async (numero) => {
        numeroUsado = numero;
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(numeroUsado, "5511888888888");
});

test("lead sem telefone não envia e explica o motivo", async () => {
  const admin = adminFalso({ telefone: null });
  let chamou = false;

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        chamou = true;
        return {};
      },
    },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /telefone/i);
  assert.equal(chamou, false);
});

test("texto em branco é recusado antes de qualquer escrita", async () => {
  const admin = adminFalso();
  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "   " },
    { enviar: async () => ({}) },
  );
  assert.equal(resultado.ok, false);
  assert.deepEqual(admin.ordem, []);
});

test("falha no envio devolve erro sem lançar", async () => {
  const admin = adminFalso();
  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        throw new Error("uazapi fora do ar");
      },
    },
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /uazapi/i);
});

test("lead inexistente não envia e não lança", async () => {
  // Sem este teste, apagar a guarda de lead ausente passaria despercebido — e
  // o efeito seria um TypeError em lead.telefone, quebrando o contrato de
  // "nunca lança" de que o worker e a server function dependem.
  const admin = adminFalso({ leadExiste: false });
  let chamou = false;

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "sumido", texto: "oi" },
    {
      enviar: async () => {
        chamou = true;
        return {};
      },
    },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /lead/i);
  assert.equal(chamou, false);
});

test("erro de banco no lookup não vira 'lead não encontrado'", async () => {
  // Falha de conexão e lead inexistente são causas diferentes; confundi-las
  // esconde uma queda de banco atrás de uma mensagem tranquilizadora.
  const admin = adminFalso({ erroNoLead: "connection reset" });

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    { enviar: async () => ({}) },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /connection reset/i);
});

test("marca como lida tanto no sucesso quanto na falha de envio", async () => {
  // Abrir a conversa e responder é a definição de "li". Se marcarLida sumisse,
  // nenhum dos outros testes notaria.
  const comSucesso = adminFalso();
  await responderComoHumano(
    comSucesso,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    { enviar: async () => ({ messageid: "prov-1" }) },
  );
  assert.ok(
    comSucesso.ordem.some((p: string) => p.startsWith("update:leads:nao_lidas")),
    "não marcou como lida depois de enviar",
  );

  const comFalha = adminFalso();
  await responderComoHumano(
    comFalha,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        throw new Error("uazapi fora do ar");
      },
    },
  );
  assert.ok(
    comFalha.ordem.some((p: string) => p.startsWith("update:leads:nao_lidas")),
    "não marcou como lida quando o envio falhou",
  );
});

test("lead sem telefone nem chega a pausar a IA", async () => {
  // Não há o que assumir numa conversa para a qual não dá para responder.
  const admin = adminFalso({ telefone: null });
  await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    { enviar: async () => ({}) },
  );
  assert.equal(
    admin.ordem.some((p: string) => p.startsWith("update:conversas:pausada_pela_ia")),
    false,
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --experimental-strip-types src/lib/crm/inbox.server.test.ts`
Expected: FAIL — `Cannot find module './inbox.server.ts'`

- [ ] **Step 3: Implementar**

Cria `src/lib/crm/inbox.server.ts`:

```ts
// Resposta manual do Pedro pelo inbox. Fica separado de mensagens.server.ts
// porque coordena três módulos (conversa, mensagem, lead) e nenhum deles é
// dono dos três — mesma razão de nao-perturbe.server.ts existir à parte.
import { marcarLida, pausarIa } from "./conversas.server.ts";
import { enviarTextoDoCrm } from "./mensagens.server.ts";

export type ParamsResposta = {
  conversaId: string;
  leadId: string;
  texto: string;
};

export type DepsResposta = {
  /** Injetável só para teste. Em produção resolve para a UAZAPI. */
  enviar?: (numero: string, texto: string) => Promise<any>;
};

/**
 * Responder é assumir: pausa a IA, envia como "humano" e zera as não lidas.
 *
 * A ordem importa. Se o envio viesse antes da pausa, um worker que acordasse
 * na janela entregaria ao lead a mensagem do Pedro e a da IA quase juntas,
 * possivelmente se contradizendo.
 *
 * O telefone é lido do banco, nunca recebido por parâmetro: esta função é
 * alcançável pela internet através de uma server function rodando com service
 * role, e aceitar o número de fora transformaria o inbox num disparador de
 * WhatsApp para qualquer destino.
 *
 * Nunca lança — devolve { ok, erro }, no mesmo contrato de enviarTextoDoCrm.
 */
export async function responderComoHumano(
  admin: any,
  params: ParamsResposta,
  deps: DepsResposta = {},
): Promise<{ ok: boolean; erro?: string }> {
  const texto = params.texto?.trim();
  if (!texto) return { ok: false, erro: "texto vazio" };

  const { data: lead, error: erroLead } = await admin
    .from("leads")
    .select("id, telefone")
    .eq("id", params.leadId)
    .maybeSingle();

  // Distinguir falha de banco de lead inexistente: o supabase-js resolve com
  // { data, error } em vez de rejeitar, então ignorar o error faria uma queda
  // de conexão chegar ao operador como "lead não encontrado".
  if (erroLead) return { ok: false, erro: erroLead.message };
  if (!lead) return { ok: false, erro: "lead não encontrado" };
  if (!lead.telefone) {
    // Lead que chegou só com @lid: não há para onde enviar. A tela desabilita
    // a caixa de resposta com esta explicação.
    return { ok: false, erro: "lead sem telefone real — não é possível responder" };
  }

  await pausarIa(admin, params.conversaId);

  const envio = await enviarTextoDoCrm(
    admin,
    {
      conversaId: params.conversaId,
      leadId: params.leadId,
      telefone: lead.telefone,
      texto,
      remetente: "humano",
    },
    deps.enviar ? { enviar: deps.enviar } : {},
  );

  // Abrir a conversa e responder é a definição de "li": mesmo com falha no
  // envio, as não lidas foram vistas.
  await marcarLida(admin, params.leadId);

  return envio;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --experimental-strip-types src/lib/crm/inbox.server.test.ts`
Expected: PASS, 9 testes

- [ ] **Step 5: Corrigir o comentário desatualizado**

Em `src/lib/crm/mensagens.server.ts`, linhas 1-2, trocar "na Fatia 5" por "na Fatia 4":

```ts
// Histórico e envio de texto. Usado pelo agente (remetente "ia") e, na Fatia 4,
// pelo Pedro respondendo no inbox (remetente "humano") — uma implementação só.
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/crm/inbox.server.ts src/lib/crm/inbox.server.test.ts src/lib/crm/mensagens.server.ts
git commit -m "feat(crm): responderComoHumano pausa a IA antes de enviar"
```

---

### Task 7: Recheck de pausa no agente

**Files:**
- Modify: `src/lib/agente/agente.server.ts:176-178`
- Modify: `src/lib/agente/agente.server.test.ts` (acrescentar um teste)

**Interfaces:**
- Consumes: nada novo.
- Produces: nada novo. Muda apenas o comportamento de `executarTurno`, que passa a devolver `{ status: "pulado", motivo: "pausada_durante_o_turno" }` quando a conversa é pausada entre o início do turno e o envio.

**Por que esta task existe:** `executarTurno` lê `pausada_pela_ia` no começo e decide via `decidirTurno`. Entre essa checagem e a linha 178 há a chamada ao modelo — segundos, mais de dez quando há tools. Uma resposta manual nessa janela chega tarde e o lead recebe duas vozes se atropelando. O defeito só se torna alcançável agora, porque antes não existia tela para pausar.

- [ ] **Step 1: Escrever o teste que falha**

Acrescenta a `src/lib/agente/agente.server.test.ts`. Antes de escrever, abra o arquivo e reaproveite os dublês de `admin` já usados nos testes vizinhos, ajustando para que a leitura de `conversas` devolva `pausada_pela_ia: false` na primeira chamada e `true` na segunda:

```ts
test("conversa pausada durante a chamada ao modelo não envia", async () => {
  // A pausa chega depois de decidirTurno e antes do envio — exatamente a
  // janela que o inbox da Fatia 4 abriu.
  let leiturasDaConversa = 0;
  const admin = adminDeTurno({
    conversa: () => {
      leiturasDaConversa += 1;
      return { id: "conv-1", lead_id: "lead-1", pausada_pela_ia: leiturasDaConversa > 1 };
    },
  });

  let enviou = false;
  const resultado = await executarTurno(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", motivo: "resposta" },
    {
      chamar: async () => ({ texto: "resposta da IA", toolCalls: [] }),
      enviar: async () => {
        enviou = true;
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(enviou, false);
  assert.equal(resultado.status, "pulado");
  assert.equal(resultado.motivo, "pausada_durante_o_turno");
});
```

Se o dublê existente não permitir variar a resposta por chamada, estenda-o com um callback `conversa()` como acima, mantendo o comportamento atual quando o callback não for passado — os testes vizinhos não podem quebrar.

⚠️ **Vire o flag de dentro do dublê do modelo, não por contagem de leituras.** Contar leituras pina apenas que existe uma segunda consulta — um recheck colocado logo depois do `decidirTurno`, antes da chamada ao modelo, passaria no teste sem consertar nada, porque a janela que importa é justamente a da chamada ao modelo. Fazer o `chamar` marcar a pausa amarra a ordem de verdade:

```ts
  let pausada = false;
  const admin = adminDeConversa({
    "conversas.select": () => ({
      data: { id: "conv-1", lead_id: "lead-1", pausada_pela_ia: pausada },
      error: null,
    }),
  });
  // ...
    chamar: async () => {
      pausada = true; // o Pedro assumiu ENQUANTO o modelo respondia
      return { texto: "resposta da IA", toolCalls: [] };
    },
```

E acrescente um segundo teste, para o caminho de falha de leitura:

```ts
test("falha ao reler a pausa não envia — vai como erro para o worker tentar de novo", async () => {
  // Sem conseguir ler o estado, não dá para afirmar que ninguém assumiu. E
  // "erro" em vez de "pulado" porque o worker dá retry com backoff no
  // primeiro e desiste no segundo.
  let leituras = 0;
  const admin = adminDeConversa({
    "conversas.select": () => {
      leituras += 1;
      return leituras === 1
        ? { data: { id: "conv-1", lead_id: "lead-1", pausada_pela_ia: false }, error: null }
        : { data: null, error: { message: "connection reset" } };
    },
  });

  let enviou = false;
  const resultado = await executarTurno(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", motivo: "resposta" },
    {
      chamar: async () => ({ texto: "resposta da IA", toolCalls: [] }),
      enviar: async () => {
        enviou = true;
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(enviou, false);
  assert.equal(resultado.status, "erro");
  assert.match(resultado.motivo ?? "", /connection reset/i);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --experimental-strip-types src/lib/agente/agente.server.test.ts`
Expected: FAIL — `enviou` é `true` e o status é `"respondeu"`

- [ ] **Step 3: Implementar o recheck**

Em `src/lib/agente/agente.server.ts`, imediatamente antes da chamada a `enviarTextoDoCrm` (hoje na linha 178), inserir:

```ts
      // A checagem do início do turno já tem segundos de idade — a chamada ao
      // modelo demora. Se o Pedro assumiu a conversa nesse intervalo, a
      // resposta da IA não pode sair atrás da dele. Sobra a janela entre esta
      // leitura e o POST para a UAZAPI, de milissegundos: aceitável.
      const { data: conversaAgora, error: erroRecheck } = await admin
        .from("conversas")
        .select("pausada_pela_ia")
        .eq("id", ctx.conversaId)
        .maybeSingle();

      // Falhar fechado: sem conseguir ler o estado da pausa, não dá para
      // afirmar que ninguém assumiu a conversa, e enviar seria justamente o
      // atropelo que este recheck existe para impedir. Vai como "erro", não
      // como "pulado", porque o worker dá retry com backoff em erro e
      // simplesmente desiste no pulado — assim uma falha transitória de
      // leitura atrasa a resposta em vez de engoli-la.
      if (erroRecheck) {
        return { status: "erro", motivo: `falha ao reler a pausa: ${erroRecheck.message}` };
      }
      if (conversaAgora?.pausada_pela_ia) {
        return { status: "pulado", motivo: "pausada_durante_o_turno" };
      }

      const envio = await enviarTextoDoCrm(
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `bun run test`
Expected: PASS, incluindo o teste novo e todos os do agente que já existiam

- [ ] **Step 5: Commit**

```bash
git add src/lib/agente/agente.server.ts src/lib/agente/agente.server.test.ts
git commit -m "fix(agente): reler pausa antes de enviar, para não atropelar resposta humana"
```

---

### Task 8: Server functions de escrita

**Files:**
- Modify: `src/lib/crm/crm.functions.ts`
- Modify: `src/lib/crm/crm.functions.test.ts` (o invariante passa a cobrir as novas)

**Interfaces:**
- Consumes: `responderComoHumano` (Task 6); `retomarIa`, `pausarIa`, `marcarLida` de `conversas.server.ts`; `moverEstagio`, `atualizarLead`, `registrarNota` de `leads.server.ts`; `registrarNaoPerturbe` de `nao-perturbe.server.ts`; `criarTarefa`, `alternarTarefa`, `excluirTarefa` de `tarefas.server.ts`; `ESTAGIOS` de `estagios.ts`.
- Produces:
  - `responderNoInbox({ data: { conversaId, leadId, texto } }): Promise<{ ok: boolean; erro?: string }>`
  - `devolverParaIa({ data: { conversaId } })`, `pausarIaNaConversa({ data: { conversaId } })`
  - `marcarConversaLida({ data: { leadId } })`, `resolverAtencao({ data: { leadId } })`
  - `moverEstagioDoLead({ data: { leadId, estagio } })`
  - `atualizarDadosDoLead({ data: { leadId, campos } })`
  - `registrarNotaNoLead({ data: { leadId, texto } })`
  - `alternarNaoPerturbe({ data: { leadId, conversaId, motivo } })`
  - `criarTarefaDoCrm`, `alternarTarefaDoCrm`, `excluirTarefaDoCrm`
  - `reenviarMensagem({ data: { mensagemId } })`

Todas devolvem `{ ok: true }` quando não têm outro retorno útil, para o cliente ter uma resposta uniforme.

- [ ] **Step 0: Três ajustes no teste do invariante, herdados do review da Task 5**

Esta task acrescenta 13 funções ao arquivo que o invariante vigia, então é a hora de fechar o que ficou aberto lá. Em `src/lib/crm/crm.functions.test.ts`:

**(a) Contar `createServerFn` na fonte CRUA, não na já sem comentários.** Hoje `brutas` é calculado depois do `semComentarios`, e a remoção de bloco roda antes da de linha — então um `/*` solto dentro de um `//` casa com um `*/` posterior e apaga tudo entre os dois, inclusive declarações inteiras. Como a contagem também é feita na fonte mutilada, ela concorda com o sumiço e o teste passa. Guarde a fonte crua junto da tratada e conte nela:

```ts
const ARQUIVOS = acharFunctions(DIR_SRC).map((caminho) => {
  const bruta = readFileSync(caminho, "utf8");
  return { nome: caminho.split(/[\\/]/).pop()!, bruta, fonte: semComentarios(bruta) };
});
```

e no teste da contagem use `bruta` para o `match` e `fonte` para os nomes. Assim qualquer deleção causada pelo próprio stripping vira divergência — que é exatamente o sinal que se quer.

**(b) Devolver a mensagem por função no teste de sessão.** O `assert.deepEqual` do round anterior aponta o nome, mas não diz por que aquilo é grave. Antes do `deepEqual`, afirme por nome:

```ts
      if (!temSessao && !SEM_SESSAO_PERMITIDAS.includes(nome)) {
        assert.fail(`${nome} não encadeia exigirSessao — endpoint público no banco (service role ignora o RLS)`);
      }
```

mantendo o `deepEqual` depois, que é o que pega o caso inverso (uma exceção a mais ou renomeada).

**(c) Corrigir "escrita" para "no banco" na mensagem.** As funções de leitura também ficam expostas sem o middleware; dizer "escrita" faz um leitor futuro achar que um GET desprotegido é inofensivo.

Rode a suíte depois destes três e antes de escrever as funções novas — eles não dependem delas.

- [ ] **Step 1: Implementar**

Acrescenta ao final de `src/lib/crm/crm.functions.ts`:

```ts
import { ESTAGIOS } from "./estagios.ts";

export const responderNoInbox = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        conversaId: z.string().uuid(),
        leadId: z.string().uuid(),
        texto: z.string().min(1).max(4096),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { responderComoHumano } = await import("./inbox.server.ts");
    return responderComoHumano(supabaseAdmin, data);
  });

export const devolverParaIa = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porConversa.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { retomarIa } = await import("./conversas.server.ts");
    await retomarIa(supabaseAdmin, data.conversaId);
    return { ok: true };
  });

export const pausarIaNaConversa = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porConversa.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { pausarIa } = await import("./conversas.server.ts");
    await pausarIa(supabaseAdmin, data.conversaId);
    return { ok: true };
  });

export const marcarConversaLida = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { marcarLida } = await import("./conversas.server.ts");
    await marcarLida(supabaseAdmin, data.leadId);
    return { ok: true };
  });

export const resolverAtencao = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porLead.parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("leads").update({ precisa_atencao: false }).eq("id", data.leadId);
    await supabaseAdmin
      .from("eventos_lead")
      .insert({ lead_id: data.leadId, tipo_evento: "atencao_resolvida", detalhe: {} });
    return { ok: true };
  });

export const moverEstagioDoLead = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ leadId: z.string().uuid(), estagio: z.enum(ESTAGIOS) }).parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { moverEstagio } = await import("./leads.server.ts");
    const mudou = await moverEstagio(supabaseAdmin, data.leadId, data.estagio, { origem: "inbox" });
    return { ok: mudou };
  });

export const atualizarDadosDoLead = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        campos: z.object({
          nome: z.string().max(120).nullable().optional(),
          maquina_interesse: z.string().max(120).nullable().optional(),
          comissao_estimada: z.number().nonnegative().nullable().optional(),
        }),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { atualizarLead } = await import("./leads.server.ts");
    await atualizarLead(supabaseAdmin, data.leadId, data.campos);
    return { ok: true };
  });

export const registrarNotaNoLead = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ leadId: z.string().uuid(), texto: z.string().min(1).max(2000) }).parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registrarNota } = await import("./leads.server.ts");
    await registrarNota(supabaseAdmin, data.leadId, data.texto);
    return { ok: true };
  });

/**
 * Só liga o não-perturbe. Desligar é decisão que o spec mestre reserva ao
 * banco, à mão — o opt-out é permanente por escolha de conduta do programa.
 */
export const alternarNaoPerturbe = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        conversaId: z.string().uuid().nullable().optional(),
        motivo: z.string().max(300).default("marcado manualmente no inbox"),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { registrarNaoPerturbe } = await import("./nao-perturbe.server.ts");
    await registrarNaoPerturbe(supabaseAdmin, {
      leadId: data.leadId,
      conversaId: data.conversaId ?? null,
      motivo: data.motivo,
    });
    return { ok: true };
  });

export const criarTarefaDoCrm = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        titulo: z.string().min(1).max(200),
        descricao: z.string().max(2000).nullable().optional(),
        prazo: z.string().datetime().nullable().optional(),
      })
      .parse(dados),
  )
  .handler(async ({ data }): Promise<any> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { criarTarefa } = await import("./tarefas.server.ts");
    return criarTarefa(supabaseAdmin, data);
  });

export const alternarTarefaDoCrm = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) =>
    z.object({ tarefaId: z.string().uuid(), concluida: z.boolean() }).parse(dados),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { alternarTarefa } = await import("./tarefas.server.ts");
    await alternarTarefa(supabaseAdmin, data.tarefaId, data.concluida);
    return { ok: true };
  });

export const excluirTarefaDoCrm = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => z.object({ tarefaId: z.string().uuid() }).parse(dados))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { excluirTarefa } = await import("./tarefas.server.ts");
    await excluirTarefa(supabaseAdmin, data.tarefaId);
    return { ok: true };
  });

/**
 * Reenvia uma mensagem que ficou em `falhou`. O cliente manda só qual
 * mensagem; todo o resto sai do banco.
 */
export const reenviarMensagem = createServerFn({ method: "POST" })
  .middleware([registrarErros, exigirSessao])
  .validator((dados: unknown) => porMensagem.parse(dados))
  .handler(async ({ data }): Promise<{ ok: boolean; erro?: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reenviarFalhada } = await import("./inbox.server.ts");
    return reenviarFalhada(supabaseAdmin, data.mensagemId);
  });
```

⚠️ **Por que não chamar `responderComoHumano` aqui.** A primeira versão deste plano fazia isso, e estava errada: `responderComoHumano` **insere uma mensagem nova**, deixando a original em `falhou` para sempre. Como a guarda `status !== "falhou"` relê a linha original, ela continua liberando o reenvio depois de um sucesso — então cada clique em "tentar de novo" manda mais um WhatsApp para o lead, e o botão nunca some da tela. Um duplo clique já entrega a mesma mensagem duas vezes.

O reenvio tem que reaproveitar a própria linha. Isso mora em `inbox.server.ts`, que é módulo desta fatia (criado na Task 6), então pode crescer — ao contrário dos módulos da Fatia 2.

- [ ] **Step 1b: `reenviarFalhada` em `inbox.server.ts`**

Escreva o teste primeiro, em `src/lib/crm/inbox.server.test.ts`:

```ts
test("reenvio marca pendente antes de enviar e enviada depois", async () => {
  // Passar por "pendente" é o que impede o duplo clique: a guarda de status
  // recusa qualquer segunda tentativa enquanto a primeira está em curso.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  const resultado = await reenviarFalhada(admin, "msg-1", {
    enviar: async () => ({ messageid: "prov-9" }),
  });

  assert.equal(resultado.ok, true);
  const pendente = admin.ordem.findIndex((p: string) => p === "update:mensagens:status(pendente)");
  const envio = admin.ordem.indexOf("envio");
  const enviada = admin.ordem.findIndex((p: string) => p.startsWith("update:mensagens:status(enviada)"));
  assert.ok(pendente !== -1 && pendente < envio, "não marcou pendente antes de enviar");
  assert.ok(enviada > envio, "não marcou enviada depois do envio");
});

test("reenvio não insere mensagem nova", async () => {
  // O bug que motivou esta função: inserir outra linha deixava a original em
  // falhou, o botão de reenviar nunca sumia e cada clique era um WhatsApp.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "prov-9" }) });
  assert.equal(
    admin.ordem.some((p: string) => p.startsWith("insert:mensagens")),
    false,
  );
});

test("mensagem que não está falhada é recusada", async () => {
  const admin = adminFalso({ mensagem: { status: "enviada", conteudo: "oi" } });
  let chamou = false;
  const resultado = await reenviarFalhada(admin, "msg-1", {
    enviar: async () => {
      chamou = true;
      return {};
    },
  });
  assert.equal(resultado.ok, false);
  assert.equal(chamou, false);
});

test("erro de banco ao ler a mensagem não vira 'não encontrada'", async () => {
  const admin = adminFalso({ erroNaMensagem: "connection reset" });
  const resultado = await reenviarFalhada(admin, "msg-1", { enviar: async () => ({}) });
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /connection reset/i);
});

test("falha no reenvio devolve a mensagem para falhou", async () => {
  // Senão a linha fica presa em "pendente" e o operador perde o botão.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  const resultado = await reenviarFalhada(admin, "msg-1", {
    enviar: async () => {
      throw new Error("uazapi fora do ar");
    },
  });
  assert.equal(resultado.ok, false);
  assert.ok(
    admin.ordem.some((p: string) => p.startsWith("update:mensagens:status(falhou)")),
    "não devolveu para falhou",
  );
});
```

Estenda `adminFalso` com as opções `mensagem` e `erroNaMensagem`, e faça o registro de `update` em `mensagens` incluir o status entre parênteses (`update:mensagens:status(pendente)`), para que a ordem seja verificável. Depois implemente:

```ts
/**
 * Reenvia uma mensagem que ficou em `falhou`, reaproveitando a MESMA linha.
 *
 * Inserir uma linha nova deixaria a original em `falhou` para sempre: o botão
 * de reenviar não sumiria da tela e cada clique viraria outro WhatsApp para o
 * lead.
 *
 * O duplo clique é barrado pelo próprio UPDATE, não pela leitura anterior:
 * `.eq("status", "falhou")` no update faz o Postgres travar a linha e só uma
 * das chamadas concorrentes acha o que atualizar. Conferir o status depois de
 * ler não bastaria — entre a leitura e a escrita há dois round-trips, tempo
 * de sobra para duas requisições passarem juntas pela mesma checagem.
 *
 * Nunca lança: devolve { ok, erro }, no mesmo contrato de enviarTextoDoCrm.
 */
export async function reenviarFalhada(
  admin: any,
  mensagemId: string,
  deps: DepsResposta = {},
): Promise<{ ok: boolean; erro?: string }> {
  const { data: mensagem, error: erroLeitura } = await admin
    .from("mensagens")
    .select("id, conversa_id, lead_id, conteudo, status")
    .eq("id", mensagemId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, erro: erroLeitura.message };
  if (!mensagem) return { ok: false, erro: "mensagem não encontrada" };
  if (mensagem.status !== "falhou") return { ok: false, erro: "mensagem não está falhada" };

  const texto = mensagem.conteudo?.trim();
  if (!texto) return { ok: false, erro: "mensagem sem texto para reenviar" };

  const { data: lead, error: erroLead } = await admin
    .from("leads")
    .select("id, telefone")
    .eq("id", mensagem.lead_id)
    .maybeSingle();

  if (erroLead) return { ok: false, erro: erroLead.message };
  if (!lead?.telefone) return { ok: false, erro: "lead sem telefone real" };

  // Resolver o remetente ANTES de mexer no status. Se ficasse depois, uma
  // falha aqui (token ausente, import quebrado) lançaria com a linha já em
  // `pendente` e sem rollback — presa fora de `falhou`, sem botão de reenviar.
  let enviar: (numero: string, texto: string) => Promise<any>;
  try {
    enviar = deps.enviar ?? (await resolverEnvioUazapi());
  } catch (err: any) {
    return { ok: false, erro: err?.message ?? "não foi possível preparar o envio" };
  }

  // Compare-and-swap: só sai de `falhou` quem chegou primeiro.
  const { data: travadas, error: erroTrava } = await admin
    .from("mensagens")
    .update({ status: "pendente" })
    .eq("id", mensagemId)
    .eq("status", "falhou")
    .select("id");

  if (erroTrava) return { ok: false, erro: erroTrava.message };
  if (!travadas || travadas.length === 0) {
    return { ok: false, erro: "reenvio já em andamento" };
  }

  let resposta: any;
  try {
    resposta = await enviar(lead.telefone, texto);
  } catch (err: any) {
    const erroEnvio = err?.message ?? "erro desconhecido ao reenviar";
    // A volta para `falhou` é o que devolve o botão ao operador; se ela também
    // falhar, a linha fica em `pendente` e isso precisa aparecer no erro em
    // vez de sumir — mesmo cuidado do marcarFalhou em mensagens.server.ts.
    const { error: erroVolta } = await admin
      .from("mensagens")
      .update({ status: "falhou" })
      .eq("id", mensagemId);
    if (erroVolta) {
      return {
        ok: false,
        erro: `${erroEnvio} (e a mensagem ficou presa em "pendente": ${erroVolta.message})`,
      };
    }
    return { ok: false, erro: erroEnvio };
  }

  const { error: erroFinal } = await admin
    .from("mensagens")
    .update({ status: "enviada", provider_message_id: resposta?.messageid ?? resposta?.id ?? null })
    .eq("id", mensagemId);

  // Entregue de verdade: `ok` continua true mesmo se o carimbo falhar, senão a
  // tela ofereceria reenviar algo que o cliente já recebeu.
  if (erroFinal) {
    return { ok: true, erro: `mensagem reenviada, mas falha ao marcar "enviada": ${erroFinal.message}` };
  }
  return { ok: true };
}

/** Resolve o envio real só quando não há dublê — mantém a UAZAPI fora do teste. */
async function resolverEnvioUazapi(): Promise<(numero: string, texto: string) => Promise<any>> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) throw new Error("UAZAPI_TOKEN não configurado");
  const { enviarTexto } = await import("../uazapi/client.server.ts");
  return (numero, texto) => enviarTexto(token, numero, texto);
}
```

Três testes a mais, além dos cinco acima:

```ts
test("segunda chamada concorrente não reenvia — o CAS recusa", async () => {
  // O update é que barra, não a leitura: as duas chamadas leem "falhou".
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" }, casFalhaApos: 1 });
  const primeira = await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "p1" }) });
  const segunda = await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "p2" }) });

  assert.equal(primeira.ok, true);
  assert.equal(segunda.ok, false);
  assert.match(segunda.erro ?? "", /andamento/i);
});

test("falha ao preparar o envio não deixa a linha em pendente", async () => {
  // Sem deps.enviar de propósito: é o resolverEnvioUazapi REAL que precisa
  // lançar, dentro do try, antes de qualquer escrita de status. Injetar um
  // dublê que lança não serve — o passo de resolução só REFERENCIA deps.enviar
  // num nullish check e nunca o chama, então o throw cairia lá adiante, no
  // envio, depois do CAS já ter mexido no status.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  const tokenOriginal = process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_TOKEN;
  try {
    const resultado = await reenviarFalhada(admin, "msg-1", {});
    assert.equal(resultado.ok, false);
    assert.equal(
      admin.ordem.some((p: string) => p.includes("status(pendente)")),
      false,
      "mexeu no status antes de saber que conseguiria enviar",
    );
  } finally {
    if (tokenOriginal === undefined) delete process.env.UAZAPI_TOKEN;
    else process.env.UAZAPI_TOKEN = tokenOriginal;
  }
});

test("carimba o provider_message_id do reenvio", async () => {
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "prov-9" }) });
  assert.ok(
    admin.ordem.some((p: string) => p.includes("provider_message_id=prov-9")),
    "não gravou o id do provedor",
  );
});
```

O dublê precisa de duas capacidades novas: `casFalhaApos` (a partir da N-ésima tentativa, o update com filtro de status devolve lista vazia) e registrar `provider_message_id=<valor>` junto do status, para que o carimbo seja verificável — hoje o dublê descarta todo campo que não seja `status`.

Move o `import { ESTAGIOS }` para junto dos outros imports no topo do arquivo — `estagios.ts` é puro (sem env, sem banco), então pode ir ao bundle do cliente sem problema.

- [ ] **Step 2: Rodar o invariante sobre as funções novas**

Run: `node --test --experimental-strip-types src/lib/crm/crm.functions.test.ts`
Expected: PASS — o teste percorre todas as `createServerFn` do arquivo, então as 13 novas já entram na verificação sem mudança no teste

- [ ] **Step 3: Rodar a suíte inteira e o TypeScript**

Run: `bun run test` e depois, em separado, `bunx tsc --noEmit`
(separados de propósito: o `tsc` sai com código 1 por causa dos 7 erros pré-existentes, então encadear com `&&` engoliria o comando seguinte)
Expected: suíte PASS; `tsc` sem nenhum erro além dos 7 listados nas Global Constraints

- [ ] **Step 4: Commit**

```bash
git add src/lib/crm/crm.functions.ts
git commit -m "feat(crm): server functions de escrita do inbox"
```

---

### Task 9: Lista de conversas

**Files:**
- Create: `src/components/crm/ListaConversas.tsx`
- Create: `src/components/crm/useConversas.ts`
- Create: `src/components/crm/rotulos.ts`
- Create: `src/components/crm/rotulos.test.ts`
- Modify: `src/routes/_app/inbox.tsx`

**Interfaces:**
- Consumes: `listarConversasDoInbox` (Task 5).
- Produces:
  - `rotuloDeEstagio(estagio: string): string` e `resumoDaLinha(conversa: any): { titulo: string; assumida: boolean }` em `rotulos.ts`
  - `useConversas()` em `useConversas.ts` — a query compartilhada do inbox. **As Tasks 10 e 12 consomem este hook; nenhuma delas repete o bloco de `useQuery`.**
  - `<ListaConversas />`, que se vira sozinho com os próprios dados (nenhuma prop)

- [ ] **Step 1: Escrever o teste dos rótulos**

A lógica de apresentação testável fica fora do componente. Cria `src/components/crm/rotulos.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rotuloDeEstagio, resumoDaLinha } from "./rotulos.ts";

test("cada estágio tem rótulo legível em português", () => {
  assert.equal(rotuloDeEstagio("apresentando_solucao"), "Apresentando solução");
  assert.equal(rotuloDeEstagio("link_enviado"), "Link enviado");
  assert.equal(rotuloDeEstagio("convertido"), "Convertido");
});

test("estágio desconhecido não quebra a tela", () => {
  assert.equal(rotuloDeEstagio("inventado"), "inventado");
});

test("lead sem nome aparece pelo telefone", () => {
  const { titulo } = resumoDaLinha({ nome: null, telefone: "5511999999999" });
  assert.equal(titulo, "5511999999999");
});

test("lead sem nome e sem telefone ainda tem título", () => {
  // Lead que chegou só com @lid: a linha não pode ficar em branco.
  const { titulo } = resumoDaLinha({ nome: null, telefone: null });
  assert.equal(titulo, "Sem identificação");
});

test("conversa pausada pela IA é a que o Pedro assumiu", () => {
  assert.equal(resumoDaLinha({ conversas: [{ pausada_pela_ia: true }] }).assumida, true);
  assert.equal(resumoDaLinha({ conversas: [{ pausada_pela_ia: false }] }).assumida, false);
  assert.equal(resumoDaLinha({ conversas: [] }).assumida, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --experimental-strip-types src/components/crm/rotulos.test.ts`
Expected: FAIL — `Cannot find module './rotulos.ts'`

- [ ] **Step 3: Implementar os rótulos**

Cria `src/components/crm/rotulos.ts`:

```ts
// Apresentação pura: sem React, sem banco, sem alias — para o node --test
// conseguir importar.

const ROTULOS: Record<string, string> = {
  novo: "Novo",
  qualificando: "Qualificando",
  apresentando_solucao: "Apresentando solução",
  contornando_objecao: "Contornando objeção",
  link_enviado: "Link enviado",
  acompanhamento: "Acompanhamento",
  convertido: "Convertido",
  perdido: "Perdido",
};

/** Estágio desconhecido volta como veio: um funil novo no banco não pode
 *  deixar a linha em branco antes de alguém atualizar este mapa. */
export function rotuloDeEstagio(estagio: string): string {
  return ROTULOS[estagio] ?? estagio;
}

export function resumoDaLinha(conversa: any): { titulo: string; assumida: boolean } {
  const titulo = conversa?.nome?.trim() || conversa?.telefone || "Sem identificação";
  const assumida = Boolean(conversa?.conversas?.[0]?.pausada_pela_ia);
  return { titulo, assumida };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --experimental-strip-types src/components/crm/rotulos.test.ts`
Expected: PASS, 5 testes

- [ ] **Step 5: Criar o hook compartilhado da listagem**

Três telas precisam da mesma listagem (esta, a rota da conversa na Task 10 e a barra superior na Task 12). O React Query deduplica pela chave, mas o bloco de configuração não pode existir em triplicata — o intervalo de polling tem que ter um lugar só para mudar.

Cria `src/components/crm/useConversas.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { listarConversasDoInbox } from "@/lib/crm/crm.functions";

/** A listagem do inbox, compartilhada por toda tela que precisa dela.
 *  Um usuário só: 5s de polling custa nada e dispensa a infra do Realtime. */
export function useConversas() {
  return useQuery({
    queryKey: ["conversas"],
    queryFn: () => listarConversasDoInbox(),
    refetchInterval: 5000,
    // Aba escondida não precisa acordar o banco a noite inteira; o
    // refetchOnWindowFocus do root traz tudo de volta ao voltar.
    refetchIntervalInBackground: false,
  });
}
```

- [ ] **Step 6: Implementar o componente**

Cria `src/components/crm/ListaConversas.tsx`:

```tsx
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { resumoDaLinha, rotuloDeEstagio } from "./rotulos";
import { useConversas } from "./useConversas";

type Filtro = "todas" | "atencao" | "assumidas";

export function ListaConversas() {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const { conversaId } = useParams({ strict: false }) as { conversaId?: string };

  const { data: conversas = [], isLoading } = useConversas();

  const visiveis = conversas.filter((c: any) => {
    if (filtro === "atencao") return c.precisa_atencao;
    if (filtro === "assumidas") return resumoDaLinha(c).assumida;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-[var(--color-borda)] p-2 text-sm">
        {(
          [
            ["todas", "Todas"],
            ["atencao", "Atenção"],
            ["assumidas", "Você assumiu"],
          ] as Array<[Filtro, string]>
        ).map(([valor, texto]) => (
          <button
            key={valor}
            onClick={() => setFiltro(valor)}
            className={
              filtro === valor
                ? "rounded bg-[var(--color-painel)] px-2 py-1"
                : "px-2 py-1 text-[var(--color-suave)]"
            }
          >
            {texto}
          </button>
        ))}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <li className="p-4 text-[var(--color-suave)]">Carregando…</li>}
        {!isLoading && visiveis.length === 0 && (
          <li className="p-4 text-[var(--color-suave)]">Nenhuma conversa neste filtro.</li>
        )}
        {visiveis.map((lead: any) => {
          const { titulo, assumida } = resumoDaLinha(lead);
          const conversa = lead.conversas?.[0];
          const selecionada = conversa?.id === conversaId;
          return (
            <li key={lead.id}>
              <Link
                to="/inbox/$conversaId"
                params={{ conversaId: conversa?.id ?? "" }}
                search={{ leadId: lead.id }}
                disabled={!conversa?.id}
                className={`block border-b border-[var(--color-borda)] p-3 ${
                  selecionada ? "bg-[var(--color-painel)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
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
                <div className="flex gap-2 text-xs text-[var(--color-suave)]">
                  <span>{rotuloDeEstagio(lead.estagio ?? "")}</span>
                  <span>·</span>
                  <span>{assumida ? "você assumiu" : "IA respondendo"}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 7: Ligar no layout do inbox e criar o stub da rota de conversa**

Em `src/routes/_app/inbox.tsx`, trocar o `<p>` placeholder por `<ListaConversas />`, importando de `@/components/crm/ListaConversas`.

⚠️ O `Link` do TanStack Router é tipado contra as rotas geradas: apontar para `/inbox/$conversaId` antes que o arquivo exista dá três erros de tipo (`TS2322` no `to`, `TS2353` em cada param). Como a Task 10 é que preenche essa tela, crie aqui o esqueleto — mesmo padrão que a Task 10 usa para `PainelLead`.

Cria `src/routes/_app/inbox.$conversaId.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";

// Esqueleto: a Task 10 preenche o corpo. Existe desde já porque o Link da
// lista é tipado contra a árvore de rotas gerada — sem o arquivo, apontar
// para cá não compila. A assinatura de busca já é a definitiva.
export const Route = createFileRoute("/_app/inbox/$conversaId")({
  validateSearch: (busca: Record<string, unknown>) => ({
    leadId: String(busca.leadId ?? ""),
  }),
  component: () => null,
});
```

Rode `bun run build` depois de criá-lo para o plugin regenerar `src/routeTree.gen.ts`, e só então confira o `tsc`.

- [ ] **Step 8: Verificar manualmente**

Run: `bun run dev`

1. Entrar e abrir `/inbox` — a lista mostra os leads existentes, mais recente no topo.
2. Se o banco estiver vazio: `bun run seed:demo` e recarregar.
3. Trocar entre os três filtros e conferir que a contagem muda.
4. Mandar uma mensagem real para o número da instância e confirmar que a linha aparece sozinha em até ~5 segundos, sem F5.

- [ ] **Step 9: Commit**

```bash
git add src/components/crm/ListaConversas.tsx src/components/crm/useConversas.ts \
  src/components/crm/rotulos.ts src/components/crm/rotulos.test.ts src/routes/_app/inbox.tsx
git commit -m "feat(inbox): lista de conversas com filtros e polling"
```

---

### Task 10: A conversa — histórico, mídia e resposta

**Files:**
- Modify: `src/routes/_app/inbox.$conversaId.tsx` (a Task 9 deixou o esqueleto; troque o corpo, mantendo o `validateSearch`)
- Create: `src/components/crm/Historico.tsx`
- Create: `src/components/crm/Bolha.tsx`
- Create: `src/components/crm/CaixaDeResposta.tsx`
- Modify: `src/routeTree.gen.ts` (gerado)

**Interfaces:**
- Consumes: `listarMensagensDaConversa`, `obterUrlDeMidia` (Task 5); `responderNoInbox`, `devolverParaIa`, `pausarIaNaConversa`, `reenviarMensagem` (Task 8); `obterLeadDoCrm` (Task 5, para saber telefone e estado).
- Produces: rota `/inbox/$conversaId` com busca `{ leadId: string }`.

- [ ] **Step 1: Criar a bolha**

Cria `src/components/crm/Bolha.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { obterUrlDeMidia } from "@/lib/crm/crm.functions";

/** Três aparências, não duas: confundir IA com humano faz o Pedro repetir ou
 *  contradizer o que a Mika já disse. */
const FUNDO: Record<string, string> = {
  lead: "var(--color-lead)",
  ia: "var(--color-ia)",
  humano: "var(--color-humano)",
};

export function Bolha({ mensagem, aoReenviar }: { mensagem: any; aoReenviar: (id: string) => void }) {
  const daCasa = mensagem.remetente !== "lead";
  const temMidia = Boolean(mensagem.media_path);

  const { data: midia } = useQuery({
    queryKey: ["midia", mensagem.id],
    queryFn: () => obterUrlDeMidia({ data: { mensagemId: mensagem.id } }),
    enabled: temMidia,
    // A URL assinada vale 5 min; renova com folga antes de expirar.
    staleTime: 4 * 60 * 1000,
  });

  return (
    <div className={`flex ${daCasa ? "justify-end" : "justify-start"} px-4 py-1`}>
      <div
        className="max-w-[70%] rounded-lg px-3 py-2"
        style={{ background: FUNDO[mensagem.remetente] ?? "var(--color-lead)" }}
      >
        <div className="mb-1 text-xs text-[var(--color-suave)]">
          {mensagem.remetente === "lead" ? "Cliente" : mensagem.remetente === "ia" ? "Mika" : "Você"}
        </div>

        {mensagem.tipo === "imagem" && midia?.url && (
          <a href={midia.url} target="_blank" rel="noreferrer">
            <img src={midia.url} alt="Imagem enviada" className="max-h-64 rounded" />
          </a>
        )}

        {mensagem.tipo === "audio" && (
          <div>
            {midia?.url && <audio controls src={midia.url} className="w-full" />}
            <p className="mt-1 text-sm italic">
              {mensagem.transcricao_status === "failed"
                ? "Não foi possível transcrever este áudio."
                : (mensagem.transcricao ?? "Transcrevendo…")}
            </p>
          </div>
        )}

        {mensagem.tipo === "documento" && midia?.url && (
          <a href={midia.url} target="_blank" rel="noreferrer" className="underline">
            Abrir documento
          </a>
        )}

        {mensagem.conteudo && <p className="whitespace-pre-wrap">{mensagem.conteudo}</p>}

        {mensagem.status === "falhou" && (
          <div
            className="mt-2 rounded px-2 py-1 text-xs"
            style={{ background: "var(--color-alerta)" }}
          >
            Não entregue.{" "}
            <button onClick={() => aoReenviar(mensagem.id)} className="underline">
              Tentar de novo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar o histórico**

Cria `src/components/crm/Historico.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listarMensagensDaConversa, reenviarMensagem } from "@/lib/crm/crm.functions";
import { Bolha } from "./Bolha";

const PAGINA = 50;

export function Historico({ conversaId }: { conversaId: string }) {
  const clienteQuery = useQueryClient();
  const fim = useRef<HTMLDivElement>(null);
  const [limite, setLimite] = useState(PAGINA);

  // Trocar de conversa reinicia a paginação — senão a próxima abre já expandida.
  useEffect(() => {
    setLimite(PAGINA);
  }, [conversaId]);

  const { data: mensagens = [] } = useQuery({
    queryKey: ["mensagens", conversaId, limite],
    queryFn: () => listarMensagensDaConversa({ data: { conversaId, limite } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const reenvio = useMutation({
    mutationFn: (mensagemId: string) => reenviarMensagem({ data: { mensagemId } }),
    onSuccess: () => clienteQuery.invalidateQueries({ queryKey: ["mensagens", conversaId] }),
  });

  // Rola quando chega mensagem NOVA — não quando o botão traz mensagens
  // antigas, que mudam o length do mesmo jeito e jogariam a tela de volta ao
  // fim, anulando o "carregar mais antigas".
  const ultimaId = mensagens[mensagens.length - 1]?.id;
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [ultimaId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {/* Só oferece mais páginas enquanto a última veio cheia: se voltaram
          menos que o limite, o começo da conversa já está na tela. */}
      {mensagens.length >= limite && (
        <button
          onClick={() => setLimite((atual) => atual + PAGINA)}
          className="mx-auto mb-2 block text-sm text-[var(--color-suave)] underline"
        >
          Carregar mais antigas
        </button>
      )}
      {mensagens.map((mensagem: any) => (
        <Bolha key={mensagem.id} mensagem={mensagem} aoReenviar={(id) => reenvio.mutate(id)} />
      ))}
      <div ref={fim} />
    </div>
  );
}
```

- [ ] **Step 3: Criar a caixa de resposta**

Cria `src/components/crm/CaixaDeResposta.tsx`:

```tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { responderNoInbox } from "@/lib/crm/crm.functions";

export function CaixaDeResposta({
  conversaId,
  leadId,
  iaAtiva,
  temTelefone,
}: {
  conversaId: string;
  leadId: string;
  iaAtiva: boolean;
  temTelefone: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const clienteQuery = useQueryClient();

  const envio = useMutation({
    mutationFn: () => responderNoInbox({ data: { conversaId, leadId, texto: texto.trim() } }),
    onSuccess: (resultado) => {
      if (!resultado.ok) {
        setErro(resultado.erro ?? "Não foi possível enviar.");
        return;
      }
      // Só limpa depois de confirmado: perder o texto digitado por causa de
      // uma falha de envio é o tipo de coisa que faz abandonar a ferramenta.
      setTexto("");
      setErro(null);
      clienteQuery.invalidateQueries({ queryKey: ["mensagens", conversaId] });
      clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
      clienteQuery.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onError: () => setErro("Não foi possível enviar."),
  });

  if (!temTelefone) {
    return (
      <div className="border-t border-[var(--color-borda)] p-3 text-sm text-[var(--color-suave)]">
        Este lead chegou sem telefone real (identificador @lid). Não há para onde enviar
        mensagem — o histórico continua sendo registrado.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-borda)] p-3">
      {iaAtiva && (
        <p className="mb-1 text-xs text-[var(--color-suave)]">
          Ao responder, você assume a conversa e a IA para.
        </p>
      )}
      <textarea
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Enter" && !evento.shiftKey && texto.trim()) {
            evento.preventDefault();
            envio.mutate();
          }
        }}
        rows={3}
        placeholder="Escreva sua resposta… (Enter envia, Shift+Enter quebra linha)"
        className="w-full rounded bg-[var(--color-painel)] p-2"
      />
      {erro && <p className="text-sm text-red-400">{erro}</p>}
      <button
        onClick={() => envio.mutate()}
        disabled={!texto.trim() || envio.isPending}
        className="mt-1 rounded bg-[var(--color-ia)] px-3 py-1 disabled:opacity-50"
      >
        {envio.isPending ? "Enviando…" : "Enviar"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Criar a rota da conversa**

Cria `src/routes/_app/inbox.$conversaId.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { devolverParaIa, obterLeadDoCrm, pausarIaNaConversa } from "@/lib/crm/crm.functions";
import { CaixaDeResposta } from "@/components/crm/CaixaDeResposta";
import { Historico } from "@/components/crm/Historico";
import { PainelLead } from "@/components/crm/PainelLead";
import { useConversas } from "@/components/crm/useConversas";

export const Route = createFileRoute("/_app/inbox/$conversaId")({
  validateSearch: (busca: Record<string, unknown>) => ({
    leadId: String(busca.leadId ?? ""),
  }),
  component: TelaConversa,
});

function TelaConversa() {
  const { conversaId } = Route.useParams();
  const { leadId } = Route.useSearch();
  const clienteQuery = useQueryClient();

  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => obterLeadDoCrm({ data: { leadId } }),
    enabled: Boolean(leadId),
  });

  // O estado da IA vive na conversa, que já vem na listagem do inbox —
  // reaproveita o cache do hook em vez de uma consulta só para isso.
  const { data: conversas = [] } = useConversas();
  const conversa = conversas
    .flatMap((l: any) => l.conversas ?? [])
    .find((c: any) => c.id === conversaId);
  const iaAtiva = !conversa?.pausada_pela_ia;

  const alternarIa = useMutation({
    mutationFn: () =>
      iaAtiva ? pausarIaNaConversa({ data: { conversaId } }) : devolverParaIa({ data: { conversaId } }),
    onSuccess: () => clienteQuery.invalidateQueries({ queryKey: ["conversas"] }),
  });

  return (
    <div className="grid h-full grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--color-borda)] px-4 py-2">
          <strong>{lead?.nome ?? lead?.telefone ?? "Conversa"}</strong>
          <span className="text-sm text-[var(--color-suave)]">{lead?.telefone ?? "sem telefone"}</span>
          <span className="ml-auto text-sm text-[var(--color-suave)]">
            {iaAtiva ? "IA respondendo" : "você assumiu"}
          </span>
          <button
            onClick={() => alternarIa.mutate()}
            className="rounded bg-[var(--color-painel)] px-3 py-1 text-sm"
          >
            {iaAtiva ? "Assumir" : "Devolver para a IA"}
          </button>
        </header>

        <Historico conversaId={conversaId} />

        <CaixaDeResposta
          conversaId={conversaId}
          leadId={leadId}
          iaAtiva={iaAtiva}
          temTelefone={Boolean(lead?.telefone)}
        />
      </div>

      <PainelLead leadId={leadId} conversaId={conversaId} />
    </div>
  );
}
```

`PainelLead` só ganha corpo na Task 11. Para esta task compilar e ser verificável, crie o arquivo `src/components/crm/PainelLead.tsx` com um stub — e **exatamente com esta assinatura**, que é a que a Task 11 vai preencher:

```tsx
// Stub — o corpo chega na Task 11.
export function PainelLead(_props: { leadId: string; conversaId: string }) {
  return <aside className="border-l border-[var(--color-borda)] p-4">Painel do lead (Task 11)</aside>;
}
```

Inclua esse arquivo no commit desta task; a Task 11 substitui o conteúdo dele.

- [ ] **Step 5: Verificar manualmente**

Run: `bun run dev`

1. Clicar numa conversa da lista → abre o histórico e a URL vira `/inbox/<uuid>?leadId=<uuid>`.
2. Dar F5 → continua na mesma conversa.
3. Conferir que mensagens do cliente, da Mika e suas têm **três cores diferentes**.
4. Abrir uma conversa com áudio → o player toca e a transcrição aparece abaixo.
   Numa conversa com mais de 50 mensagens, clicar em "Carregar mais antigas" → as
   anteriores aparecem **sem** a tela pular para o fim.
5. Escrever e enviar → a mensagem aparece como sua, o cabeçalho passa a "você assumiu", e a lista à esquerda reflete isso.
6. Clicar em "Devolver para a IA" → volta a "IA respondendo".

- [ ] **Step 6: Commit**

```bash
git add src/routes/_app/inbox.\$conversaId.tsx src/components/crm/Historico.tsx \
  src/components/crm/Bolha.tsx src/components/crm/CaixaDeResposta.tsx \
  src/components/crm/PainelLead.tsx src/routeTree.gen.ts
git commit -m "feat(inbox): histórico, mídia e resposta manual"
```

---

### Task 11: Painel do lead

**Files:**
- Modify: `src/components/crm/PainelLead.tsx` (a Task 10 deixou um stub; substitua o conteúdo inteiro, mantendo a assinatura `{ leadId, conversaId }`)
- Create: `src/components/crm/TarefasDoLead.tsx`

**Interfaces:**
- Consumes: `obterLeadDoCrm`, `listarTarefasDoCrm` (Task 5); `moverEstagioDoLead`, `atualizarDadosDoLead`, `registrarNotaNoLead`, `resolverAtencao`, `alternarNaoPerturbe`, `criarTarefaDoCrm`, `alternarTarefaDoCrm`, `excluirTarefaDoCrm` (Task 8); `ESTAGIOS` de `src/lib/crm/estagios.ts`; `rotuloDeEstagio` (Task 9).
- Produces: `<PainelLead leadId conversaId />` e `<TarefasDoLead leadId />`.

O bloco de tarefas sai num componente próprio: as três mutations de tarefa não têm nada a ver com estágio, dados e notas do lead, e separá-las deixa o painel em ~170 linhas em vez de ~250.

- [ ] **Step 1: Criar o componente de tarefas do lead**

Cria `src/components/crm/TarefasDoLead.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  alternarTarefaDoCrm,
  criarTarefaDoCrm,
  excluirTarefaDoCrm,
  listarTarefasDoCrm,
} from "@/lib/crm/crm.functions";

export function TarefasDoLead({ leadId }: { leadId: string }) {
  const clienteQuery = useQueryClient();
  const [titulo, setTitulo] = useState("");

  const { data: tarefas = [] } = useQuery({
    queryKey: ["tarefas", leadId],
    // apenasAbertas: false — no painel do lead as concluídas também aparecem,
    // riscadas, para dar contexto do que já foi feito com ele.
    queryFn: () => listarTarefasDoCrm({ data: { apenasAbertas: false, leadId } }),
    enabled: Boolean(leadId),
  });

  function recarregar() {
    clienteQuery.invalidateQueries({ queryKey: ["tarefas"] });
  }

  const criar = useMutation({
    mutationFn: () => criarTarefaDoCrm({ data: { leadId, titulo: titulo.trim() } }),
    onSuccess: () => {
      setTitulo("");
      recarregar();
    },
  });
  const alternar = useMutation({
    mutationFn: ({ tarefaId, concluida }: { tarefaId: string; concluida: boolean }) =>
      alternarTarefaDoCrm({ data: { tarefaId, concluida } }),
    onSuccess: recarregar,
  });
  const excluir = useMutation({
    mutationFn: (tarefaId: string) => excluirTarefaDoCrm({ data: { tarefaId } }),
    onSuccess: recarregar,
  });

  return (
    <div className="flex flex-col gap-1">
      <strong>Tarefas</strong>
      {tarefas.map((tarefa: any) => (
        <div key={tarefa.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={tarefa.concluida}
            onChange={(evento) =>
              alternar.mutate({ tarefaId: tarefa.id, concluida: evento.target.checked })
            }
          />
          <span className={tarefa.concluida ? "line-through opacity-60" : ""}>{tarefa.titulo}</span>
          <button onClick={() => excluir.mutate(tarefa.id)} className="ml-auto opacity-60">
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          placeholder="Nova tarefa"
          className="flex-1 rounded bg-[var(--color-painel)] p-1"
        />
        <button
          onClick={() => criar.mutate()}
          disabled={!titulo.trim()}
          className="rounded bg-[var(--color-painel)] px-2 disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implementar o painel**

Cria `src/components/crm/PainelLead.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ESTAGIOS } from "@/lib/crm/estagios";
import {
  alternarNaoPerturbe,
  atualizarDadosDoLead,
  moverEstagioDoLead,
  obterLeadDoCrm,
  registrarNotaNoLead,
  resolverAtencao,
} from "@/lib/crm/crm.functions";
import { rotuloDeEstagio } from "./rotulos";
import { TarefasDoLead } from "./TarefasDoLead";

export function PainelLead({ leadId, conversaId }: { leadId: string; conversaId: string }) {
  const clienteQuery = useQueryClient();
  const [nota, setNota] = useState("");

  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => obterLeadDoCrm({ data: { leadId } }),
    enabled: Boolean(leadId),
  });

  function recarregar() {
    clienteQuery.invalidateQueries({ queryKey: ["lead", leadId] });
    clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
  }

  const mudarEstagio = useMutation({
    mutationFn: (estagio: string) =>
      moverEstagioDoLead({ data: { leadId, estagio: estagio as any } }),
    onSuccess: recarregar,
  });
  const salvarCampo = useMutation({
    mutationFn: (campos: Record<string, unknown>) =>
      atualizarDadosDoLead({ data: { leadId, campos: campos as any } }),
    onSuccess: recarregar,
  });
  const salvarNota = useMutation({
    mutationFn: () => registrarNotaNoLead({ data: { leadId, texto: nota.trim() } }),
    onSuccess: () => {
      setNota("");
      recarregar();
    },
  });
  const resolver = useMutation({
    mutationFn: () => resolverAtencao({ data: { leadId } }),
    onSuccess: recarregar,
  });
  const silenciar = useMutation({
    mutationFn: () => alternarNaoPerturbe({ data: { leadId, conversaId, motivo: "marcado no inbox" } }),
    onSuccess: recarregar,
  });

  if (!lead) {
    return <aside className="border-l border-[var(--color-borda)] p-4">Carregando…</aside>;
  }

  return (
    <aside className="flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-borda)] p-4 text-sm">
      {lead.precisa_atencao && (
        <div className="rounded p-2" style={{ background: "var(--color-alerta)" }}>
          <p>A IA escalou esta conversa e parou de responder.</p>
          <button onClick={() => resolver.mutate()} className="mt-1 underline">
            Marcar como resolvido
          </button>
        </div>
      )}

      <label className="flex flex-col gap-1">
        Estágio
        <select
          value={lead.estagio ?? "novo"}
          onChange={(evento) => mudarEstagio.mutate(evento.target.value)}
          className="rounded bg-[var(--color-painel)] p-1"
        >
          {ESTAGIOS.map((estagio) => (
            <option key={estagio} value={estagio}>
              {rotuloDeEstagio(estagio)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        Nome
        <input
          defaultValue={lead.nome ?? ""}
          onBlur={(evento) => salvarCampo.mutate({ nome: evento.target.value || null })}
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        Máquina de interesse
        <input
          defaultValue={lead.maquina_interesse ?? ""}
          onBlur={(evento) => salvarCampo.mutate({ maquina_interesse: evento.target.value || null })}
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        Comissão estimada (R$)
        <input
          type="number"
          step="0.01"
          defaultValue={lead.comissao_estimada ?? ""}
          onBlur={(evento) =>
            salvarCampo.mutate({
              comissao_estimada: evento.target.value === "" ? null : Number(evento.target.value),
            })
          }
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      {lead.ad_source_id && (
        <div className="rounded bg-[var(--color-painel)] p-2">
          <strong>Veio de anúncio</strong>
          <p className="text-[var(--color-suave)]">{lead.ad_title ?? "sem título"}</p>
          <p className="text-xs text-[var(--color-suave)]">ID: {lead.ad_source_id}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <strong>Nota</strong>
        <textarea
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          rows={2}
          className="rounded bg-[var(--color-painel)] p-1"
        />
        <button
          onClick={() => salvarNota.mutate()}
          disabled={!nota.trim()}
          className="self-start rounded bg-[var(--color-painel)] px-2 py-1 disabled:opacity-50"
        >
          Salvar nota
        </button>
      </div>

      <TarefasDoLead leadId={leadId} />

      {!lead.nao_perturbe && (
        <button onClick={() => silenciar.mutate()} className="self-start text-[var(--color-suave)] underline">
          Marcar "não perturbe"
        </button>
      )}
      {lead.nao_perturbe && (
        <p className="text-[var(--color-suave)]">
          🔇 Não perturbe ativo. É permanente por conduta do programa — só é desfeito à mão no banco.
        </p>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Rodar o TypeScript**

Run: `bunx tsc --noEmit`
Expected: nenhum erro além dos 7 pré-existentes listados nas Global Constraints

- [ ] **Step 4: Verificar manualmente**

Run: `bun run dev`

1. Abrir uma conversa → o painel direito mostra os dados do lead.
2. Mudar o estágio → recarregar a página e conferir que persistiu.
3. Editar o nome e sair do campo → persiste.
4. Criar uma tarefa, marcar como concluída, excluir.
5. Numa conversa com `precisa_atencao`, clicar em "Marcar como resolvido" → o ⚠️ some da lista.
6. Se houver lead vindo de anúncio, conferir que o bloco "Veio de anúncio" aparece.

- [ ] **Step 5: Commit**

```bash
git add src/components/crm/PainelLead.tsx src/components/crm/TarefasDoLead.tsx
git commit -m "feat(inbox): painel do lead com estágio, dados, notas e tarefas"
```

---

### Task 12: Fila de tarefas e contadores na barra

**Files:**
- Create: `src/routes/_app/tarefas.tsx`
- Modify: `src/routes/_app.tsx`
- Modify: `src/routeTree.gen.ts` (gerado)

**Interfaces:**
- Consumes: `listarTarefasDoCrm`, `listarConversasDoInbox` (Task 5); `alternarTarefaDoCrm` (Task 8).
- Produces: rota `/tarefas`.

- [ ] **Step 1: Criar a tela**

Cria `src/routes/_app/tarefas.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { alternarTarefaDoCrm, listarTarefasDoCrm } from "@/lib/crm/crm.functions";
import { useConversas } from "@/components/crm/useConversas";

export const Route = createFileRoute("/_app/tarefas")({
  component: TelaTarefas,
});

function TelaTarefas() {
  const clienteQuery = useQueryClient();

  const { data: tarefas = [] } = useQuery({
    queryKey: ["tarefas", "abertas"],
    queryFn: () => listarTarefasDoCrm({ data: { apenasAbertas: true } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  // Para linkar cada tarefa à conversa do lead — a listagem do inbox já traz
  // esse mapeamento e está em cache.
  const { data: conversas = [] } = useConversas();

  const concluir = useMutation({
    mutationFn: (tarefaId: string) => alternarTarefaDoCrm({ data: { tarefaId, concluida: true } }),
    onSuccess: () => clienteQuery.invalidateQueries({ queryKey: ["tarefas"] }),
  });

  function conversaDoLead(leadId: string) {
    const lead = conversas.find((l: any) => l.id === leadId);
    return { conversaId: lead?.conversas?.[0]?.id as string | undefined, nome: lead?.nome ?? lead?.telefone };
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-medium">Tarefas abertas</h1>
      {tarefas.length === 0 && <p className="text-[var(--color-suave)]">Nada pendente.</p>}
      <ul className="flex flex-col gap-2">
        {tarefas.map((tarefa: any) => {
          const { conversaId, nome } = conversaDoLead(tarefa.lead_id);
          return (
            <li
              key={tarefa.id}
              className="flex items-center gap-3 rounded border border-[var(--color-borda)] p-3"
            >
              <input type="checkbox" checked={false} onChange={() => concluir.mutate(tarefa.id)} />
              <div className="min-w-0">
                <p className="truncate">{tarefa.titulo}</p>
                <p className="text-xs text-[var(--color-suave)]">
                  {nome ?? "lead"} {tarefa.prazo ? `· vence ${new Date(tarefa.prazo).toLocaleDateString("pt-BR")}` : ""}
                </p>
              </div>
              {conversaId && (
                <Link
                  to="/inbox/$conversaId"
                  params={{ conversaId }}
                  search={{ leadId: tarefa.lead_id }}
                  className="ml-auto underline"
                >
                  Abrir conversa
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Acrescentar os contadores à barra superior**

Em `src/routes/_app.tsx`, dentro de `LayoutApp`, buscar os dois números e mostrá-los. Acrescenta os imports de `useQuery`, `listarTarefasDoCrm` e `useConversas` (de `@/components/crm/useConversas`), e dentro do componente:

```tsx
  const { data: conversas = [] } = useConversas();
  const { data: tarefasAbertas = [] } = useQuery({
    queryKey: ["tarefas", "abertas"],
    queryFn: () => listarTarefasDoCrm({ data: { apenasAbertas: true } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const precisamAtencao = conversas.filter((lead: any) => lead.precisa_atencao).length;
```

E no `<header>`, entre o link "Conversas" e o botão "Sair":

```tsx
        {precisamAtencao > 0 && (
          <span className="rounded px-2 py-0.5 text-sm" style={{ background: "var(--color-alerta)" }}>
            {precisamAtencao} precisam de atenção
          </span>
        )}
        <Link to="/tarefas" className="text-[var(--color-suave)] hover:text-[var(--color-texto)]">
          Tarefas{tarefasAbertas.length > 0 ? ` (${tarefasAbertas.length})` : ""}
        </Link>
```

- [ ] **Step 3: Verificar manualmente**

Run: `bun run dev`

1. Criar duas tarefas pelo painel do lead.
2. Abrir `/tarefas` → as duas aparecem, com o nome do lead.
3. Clicar em "Abrir conversa" → cai na conversa certa.
4. Marcar uma como concluída → some da lista e o contador na barra cai.
5. Com um lead em `precisa_atencao`, conferir o aviso vermelho na barra.

- [ ] **Step 4: Rodar tudo**

Run, cada um em separado (o `tsc` sai com código 1 pelos erros pré-existentes e cortaria um encadeamento com `&&`): `bun run test`, `bunx tsc --noEmit`, `bun run build`
Expected: testes passando; `tsc` sem erro além dos 7 das Global Constraints; build concluído

- [ ] **Step 5: Commit**

```bash
git add src/routes/_app/tarefas.tsx src/routes/_app.tsx src/routeTree.gen.ts
git commit -m "feat(crm): fila de tarefas e contadores na barra superior"
```

---

### Task 13: Sessão expirada não perde o texto digitado

**Files:**
- Create: `src/lib/auth/sessao-expirada.ts`
- Create: `src/lib/auth/sessao-expirada.test.ts`
- Modify: `src/components/crm/CaixaDeResposta.tsx`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ehNaoAutenticado(erro: unknown): boolean`
  - `guardarRascunho(conversaId: string, texto: string): void` / `lerRascunho(conversaId: string): string` / `limparRascunho(conversaId: string): void`, todas sobre `sessionStorage` e todas sem efeito fora do browser.

- [ ] **Step 1: Escrever o teste que falha**

Cria `src/lib/auth/sessao-expirada.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ehNaoAutenticado, guardarRascunho, lerRascunho, limparRascunho } from "./sessao-expirada.ts";

test("reconhece o 401 do middleware", () => {
  assert.equal(ehNaoAutenticado(new Response("nao_autenticado", { status: 401 })), true);
  assert.equal(ehNaoAutenticado({ status: 401 }), true);
  assert.equal(ehNaoAutenticado(new Error("nao_autenticado")), true);
});

test("não confunde outros erros com sessão expirada", () => {
  assert.equal(ehNaoAutenticado(new Response("erro", { status: 500 })), false);
  assert.equal(ehNaoAutenticado(new Error("uazapi fora do ar")), false);
  assert.equal(ehNaoAutenticado(null), false);
});

test("sem sessionStorage (SSR), rascunho não quebra nem inventa texto", () => {
  // Rodando no node, globalThis.sessionStorage não existe.
  guardarRascunho("conv-1", "oi");
  assert.equal(lerRascunho("conv-1"), "");
  limparRascunho("conv-1");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test --experimental-strip-types src/lib/auth/sessao-expirada.test.ts`
Expected: FAIL — `Cannot find module './sessao-expirada.ts'`

- [ ] **Step 3: Implementar**

Cria `src/lib/auth/sessao-expirada.ts`:

```ts
// Puro e isomórfico: sem React, sem alias, seguro no SSR.

/** O middleware exigirSessao lança `new Response("nao_autenticado", {status:401})`.
 *  Dependendo de onde o erro é capturado, ele chega como Response, como objeto
 *  com status, ou como Error com a mensagem. Os três contam. */
export function ehNaoAutenticado(erro: unknown): boolean {
  if (!erro) return false;
  if (typeof erro === "object" && "status" in (erro as any)) {
    return (erro as any).status === 401;
  }
  if (erro instanceof Error) return erro.message.includes("nao_autenticado");
  return false;
}

function armazenamento(): Storage | null {
  return typeof globalThis !== "undefined" && "sessionStorage" in globalThis
    ? (globalThis as any).sessionStorage
    : null;
}

const CHAVE = (conversaId: string) => `rascunho:${conversaId}`;

export function guardarRascunho(conversaId: string, texto: string): void {
  armazenamento()?.setItem(CHAVE(conversaId), texto);
}

export function lerRascunho(conversaId: string): string {
  return armazenamento()?.getItem(CHAVE(conversaId)) ?? "";
}

export function limparRascunho(conversaId: string): void {
  armazenamento()?.removeItem(CHAVE(conversaId));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test --experimental-strip-types src/lib/auth/sessao-expirada.test.ts`
Expected: PASS, 3 testes

- [ ] **Step 5: Ligar na caixa de resposta**

Em `src/components/crm/CaixaDeResposta.tsx`:

- importar `useNavigate` de `@tanstack/react-router`, `useEffect` de `react`, e as quatro funções de `@/lib/auth/sessao-expirada`;
- inicializar o estado com o rascunho: `const [texto, setTexto] = useState(() => lerRascunho(conversaId));`
- guardar a cada mudança:

```tsx
  useEffect(() => {
    guardarRascunho(conversaId, texto);
  }, [conversaId, texto]);
```

- no `onSuccess`, trocar `setTexto("")` por `setTexto(""); limparRascunho(conversaId);`
- no `onError`, mandar para o login sem perder nada:

```tsx
    onError: (erro) => {
      if (ehNaoAutenticado(erro)) {
        // O rascunho já está no sessionStorage; ao voltar, a caixa o recupera.
        navegar({ to: "/login", search: { destino: window.location.pathname + window.location.search } });
        return;
      }
      setErro("Não foi possível enviar.");
    },
```

- [ ] **Step 6: Verificar manualmente**

Run: `bun run dev`

1. Abrir uma conversa e escrever um texto longo **sem enviar**.
2. Nas DevTools → Application → Cookies, apagar os cookies `sb-…`.
3. Clicar em Enviar → vai para o login em vez de dar erro genérico.
4. Entrar de novo → volta à mesma conversa **com o texto ainda na caixa**.

- [ ] **Step 7: Rodar tudo e commitar**

Rode `bun run test` e `bunx tsc --noEmit` separadamente e confira os dois antes de commitar — o `tsc` sai com código 1 pelos 7 erros pré-existentes, então encadear com `&&` impediria o commit.

```bash
git add src/lib/auth/sessao-expirada.ts src/lib/auth/sessao-expirada.test.ts \
  src/components/crm/CaixaDeResposta.tsx
git commit -m "feat(inbox): sessão expirada leva ao login sem perder o texto digitado"
```

---

### Task 14: Roteiro de verificação de ponta a ponta

**Files:**
- Create: `docs/superpowers/plans/2026-08-08-fatia-4-verificacao.md`

**Interfaces:** nenhuma — é a passagem final antes de dar a fatia por pronta.

- [ ] **Step 1: Rodar a suíte completa e o build**

Run, cada um em separado: `bun run test`, `bunx tsc --noEmit`, `bun run lint`, `bun run build`
Expected: testes passando, lint limpo, build concluído, e o `tsc` sem nenhum erro além dos 7 pré-existentes das Global Constraints. Se algo mais falhar, corrigir antes de seguir — esta task não "documenta" falha conhecida.

- [ ] **Step 2: Executar o roteiro com uma conversa real**

Com um número de teste, do WhatsApp real para a instância UAZAPI:

1. Mandar "oi, quero saber sobre maquininha" → em até 5s a conversa aparece no inbox, com a resposta da Mika logo em seguida.
2. Mandar um **áudio** → o player aparece e a transcrição chega abaixo.
3. Mandar uma **imagem** → a miniatura aparece e abre em tamanho maior.
4. Enquanto a Mika está respondendo (mande uma pergunta e clique rápido), **responder pelo inbox** → confirmar que só uma resposta chega ao WhatsApp e que o cabeçalho passa a "você assumiu".
5. "Devolver para a IA" → mandar outra mensagem pelo WhatsApp e confirmar que a Mika volta a responder.
6. Mover o estágio para "link_enviado" e conferir no banco que `link_enviado_em` foi carimbado.
7. Derrubar o `UAZAPI_TOKEN` (variável inválida no `.env`), reiniciar, tentar responder → a mensagem aparece em vermelho "não entregue"; restaurar o token e clicar em "Tentar de novo" → entrega.

- [ ] **Step 3: Registrar o resultado**

Escrever `docs/superpowers/plans/2026-08-08-fatia-4-verificacao.md` com o resultado de cada um dos 7 passos: o que foi observado, e para qualquer desvio, o que foi feito. Um passo que não pôde ser executado é registrado como não executado, com o motivo — não como aprovado.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-08-fatia-4-verificacao.md
git commit -m "docs(fatia-4): registro da verificação de ponta a ponta"
```

---

## Depois desta fatia

- **Fatia 3 (redefinida):** `base_conhecimento` editável, sem RAG — os blocos de `conhecimento.ts` viram linhas no banco e o servidor os injeta inteiros no prompt. O raciocínio está na seção "Decisões que afetam fatias vizinhas" do spec.
- **Dashboard:** funil por estágio, taxa de conversão, comissão no mês e comissão por `ad_source_id`. Fatia curta, sobre o layout que esta deixa pronto.
- **Fatia 5:** envio de mídia pelo CRM.
