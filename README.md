# TON-CRM-IA — Deploy no EasyPanel

Este projeto é uma aplicação **TanStack Start** (React 19 + Vite 8, runtime
**Bun**), hospedada via **EasyPanel** (self-hosted) a partir do repositório
GitHub, usando o `Dockerfile` na raiz.

## Arquitetura de build/deploy

Importante para quem for mexer nisso depois: **esta versão do
`@tanstack/react-start` (~1.168) não usa Nitro.** Isso foi confirmado lendo
o código de `node_modules/@tanstack/start-plugin-core` e observando a saída
real de `bun run build` — não existe `.output/`, `.nitro/` nem preset
nenhum. O build usa a Environments API nativa do Vite 8 e gera:

```
dist/client/assets/**   estáticos do client (JS/CSS)
dist/server/server.js   handler SSR — exporta { fetch(Request): Response }
```

`dist/server/server.js` **não sobe servidor nenhum sozinho** — é só um
handler no formato Web Fetch. Quem escuta a porta é `server.ts` (raiz do
repo): serve `dist/client/assets/**` diretamente e delega todo o resto
(páginas SSR, server functions, `/api/**`) para esse handler. Roda com
`bun run server.ts` — Bun executa TypeScript nativamente, então a imagem
final não precisa de `vite`, dos plugins do TanStack Start nem de nenhuma
outra devDependency.

O `Dockerfile` tem 3 estágios: `deps` (todas as dependências, para poder
buildar) → `build` (roda `bun run build`) → `runtime` (imagem final: só
`dist/`, `server.ts` e as dependências de produção via
`bun install --production`, rodando como usuário não-root).

## Configuração no EasyPanel

1. Crie um serviço do tipo **App** apontando para este repositório GitHub,
   branch de deploy desejada.
2. Build method: **Dockerfile** (o EasyPanel detecta o `Dockerfile` na raiz
   automaticamente).
3. Porta do container: **3000** (ou o valor que você definir em `PORT` —
   veja abaixo). Configure a porta exposta do serviço no EasyPanel para
   bater com essa.
4. Configure as variáveis de ambiente abaixo na aba **Environment** do
   serviço.
5. Domínio: configure o domínio/subdomínio do serviço normalmente pelo
   EasyPanel (proxy reverso + TLS ficam por conta dele).

### Variáveis de ambiente obrigatórias

| Variável | Para que serve |
| --- | --- |
| `SUPABASE_URL` | URL do projeto Supabase (uso server-side, service role) |
| `SUPABASE_PUBLISHABLE_KEY` | Chave publicável do Supabase (server-side) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave de service role do Supabase — acesso admin, ignora RLS. **Segredo sensível.** |
| `VITE_SUPABASE_URL` | URL do Supabase exposta ao client (bundle do navegador) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Chave publicável exposta ao client |
| `PUBLIC_SITE_URL` | URL pública de produção do site (ex.: `https://crm.seudominio.com`) |
| `UAZAPI_BASE_URL` | URL base da instância UAZAPI usada pelo CRM |
| `UAZAPI_TOKEN` | Token da instância UAZAPI (autenticação nas chamadas de API) |
| `UAZAPI_WEBHOOK_SECRET` | Segredo que valida o webhook recebido em `/api/public/uazapi` (ver seção abaixo). **Segredo sensível.** |
| `GROQ_API_KEY` | Usada para transcrição de áudio (Groq Whisper) |
| `OPENAI_API_KEY` | Usada só para embeddings da base de conhecimento (Fatia 3) — o agente de IA em si roda em outro provedor, não usa OpenAI |

### Variáveis opcionais

| Variável | Para que serve |
| --- | --- |
| `META_PIXEL_ID` | ID do Pixel da Meta, para a integração de Conversions API (CAPI). Omitido = integração CAPI fica inativa. |
| `META_CAPI_TOKEN` | Token de acesso da Conversions API da Meta. |
| `META_PAGE_ID` | Id da Página do Facebook dona do número de WhatsApp que roda os anúncios. Obrigatório junto com pixel e token: a Meta recusa todo evento de `business_messaging` sem `user_data.page_id` (400, subcode 2804116). Configurado pela metade = zero eventos e nenhuma atribuição. |
| `META_CAPI_TEST_CODE` | Código de teste da Meta (Test Events Tool), só para depuração — não usar em produção. |
| `PORT` | Porta em que o servidor escuta dentro do container. Default `3000`. |
| `HOST` | Interface em que o servidor escuta. Default `0.0.0.0` (necessário para o EasyPanel/Docker rotear tráfego até o container). |

Não coloque valores reais de nenhuma dessas variáveis neste repositório —
configure todas pela interface do EasyPanel.

## Webhook da UAZAPI — configurar por instância, nunca global

O endpoint que recebe eventos da UAZAPI é:

```
https://<dominio-do-crm>/api/public/uazapi?secret=<valor-de-UAZAPI_WEBHOOK_SECRET>
```

**O webhook precisa ser configurado no painel da própria instância UAZAPI
usada por este CRM — nunca no webhook global do servidor UAZAPI.** O
servidor UAZAPI é compartilhado com outro sistema em produção; configurar o
webhook globalmente faria eventos de outras instâncias (de outro sistema)
serem enviados para este CRM, e vice-versa.

O endpoint responde `403` para qualquer requisição sem o `secret` correto
(seja via query string `?secret=` ou header `x-uazapi-secret`) — a checagem
é *fail-closed*: sem `UAZAPI_WEBHOOK_SECRET` configurado, nada passa.

## Rodando localmente

```sh
bun install
bun run build
PORT=3000 bun run server.ts
```

(ou `bun run start`, que é o mesmo comando via script do `package.json`.)
