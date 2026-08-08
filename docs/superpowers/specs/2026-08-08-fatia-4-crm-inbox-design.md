# Fatia 4 — CRM: login, inbox e painel do lead

**Data:** 2026-08-08
**Status:** Aprovado para planejamento de implementação
**Fatias anteriores:** 1 (fundação + webhook), 2 (agente + camada de CRM)

## O que esta fatia resolve

Hoje o agente atende sozinho e não existe nenhuma tela. Não há como ver uma conversa,
assumir o atendimento, corrigir um estágio ou saber que um lead pediu atenção humana.
Toda a camada de dados para isso já existe desde a Fatia 2 — `src/lib/crm/*.server.ts`
tem `listarConversas`, `listarMensagens`, `enviarTextoDoCrm`, `pausarIa`, `retomarIa`,
`moverEstagio`, `atualizarLead`, tarefas e não-perturbe, todas escritas como funções
puras que recebem um client `admin`. `leads.server.ts` carrega o comentário
*"createServerFn que virão na Fatia 4"*.

Esta fatia constrói exatamente isso: autenticação, a camada de exposição e as telas.

**Entra:** login, lista de conversas, histórico, resposta manual, controle de
pausa/retomada da IA, painel do lead, fila de tarefas e escalações.

**Não entra:** dashboard e relatórios (fatia curta posterior), base de conhecimento
editável (Fatia 3, redefinida — ver o fim deste documento), envio de mídia pelo CRM
(Fatia 5), busca textual no histórico, notificação no navegador.

## Decisões desta fatia

- **Desktop apenas.** O layout é de três colunas fixas pensado para tela grande. Sem
  esforço de responsividade nesta fatia.
- **Supabase Auth com e-mail e senha.** O RLS da Fatia 1 já foi escrito sobre
  `auth.uid()` (`eh_dono()`); qualquer outro mecanismo exigiria contorná-lo. O usuário é
  criado uma vez à mão no painel do Supabase — não há tela de cadastro.
- **Polling de 5 segundos, não Supabase Realtime.** É um usuário só. Realtime exigiria
  `REPLICA IDENTITY FULL`, `ALTER PUBLICATION` e código de reconexão — complexidade que
  só se paga com muitos usuários simultâneos.
- **Toda leitura e escrita passa por `createServerFn`.** O browser nunca fala com o
  Supabase diretamente. Alternativa considerada e recusada: ler pelo client publicável
  com RLS. Ela funciona para leitura, mas toda escrita relevante tem efeito colateral
  server-only (enviar pela UAZAPI exige o token; mover estágio grava evento de
  auditoria), o que levaria a duas camadas de dados e às regras da Fatia 2 duplicadas.
- **Tailwind v4, sem shadcn/ui.** O spec mestre fixava shadcn, e a decisão foi revista
  durante a implementação (08/08/2026): nenhuma tela desta fatia importa um componente
  shadcn — todas usam `<button>`, `<input>`, `<select>` e `<textarea>` nativos com
  classes Tailwind. Instalar a biblioteca seria dependência morta. Some daí uma segunda
  razão: a CLI do shadcn migrou para um fluxo de presets que não roda sem terminal
  interativo. A porta continua aberta — quando uma tela pedir diálogo ou combobox de
  verdade (provavelmente o upload de mídia da Fatia 5), adotar shadcn ali é barato.
- Rotas aninhadas
  (`/inbox`, `/inbox/$conversaId`) para que abrir uma conversa produza URL linkável e
  sobreviva ao F5.

## Arquitetura

Três camadas, cada uma com uma responsabilidade.

**1. Camada de dados — já existe, não muda.** `src/lib/crm/*.server.ts` e
`src/lib/agente/*`. A única alteração prevista está descrita em "A corrida entre o
operador e o worker", abaixo, e é consequência direta desta fatia.

**2. Camada de exposição — nova.** `src/lib/crm/crm.functions.ts`, com as
`createServerFn` no padrão do CPI:
`createServerFn({method:"POST"}).middleware([exigirSessao, registrarErros]).inputValidator(zod.parse).handler(...)`.
Cada uma é fina: valida, exige sessão, faz `await import()` do `.server.ts` e delega.
Nenhuma regra de negócio nasce aqui.

⚠️ **Convenção herdada do CPI, apontada lá como origem da maioria dos bugs:** um arquivo
`.functions.ts` vai para o bundle do cliente — só o corpo do handler é removido. Nada
server-only pode ser importado no topo. Client admin, `process.env` e token da UAZAPI só
dentro do handler, via `await import()`.

**3. Camada de tela — nova.** Rotas TanStack e componentes React. Conhece apenas as
server functions.

### Estrutura de arquivos

```
src/lib/auth/
  sessao.server.ts       client Supabase SSR sobre cookie httpOnly; obterUsuario()
  middleware.ts          exigirSessao, registrarErros (ver nota abaixo)
  auth.functions.ts      entrar, sair
src/lib/crm/
  crm.functions.ts       as server functions do CRM
src/routes/
  login.tsx
  _app.tsx               layout autenticado; beforeLoad redireciona sem sessão
  _app/inbox.tsx         três colunas + lista de conversas
  _app/inbox.$conversaId.tsx   histórico, resposta e painel do lead
  _app/tarefas.tsx       fila global de tarefas abertas
src/components/
                         (sem `ui/`: ver a decisão sobre shadcn abaixo)
  crm/                   ListaConversas, Historico, CaixaDeResposta, PainelLead,
                         FilaDeTarefas
```

O layout de três colunas mora em `_app/inbox.tsx`; centro e direita são preenchidos pela
rota filha.

## Autenticação

Dependência nova: `@supabase/ssr`.

`sessao.server.ts` monta o client com adaptador de cookie ligado aos helpers do TanStack
Start (`getCookies()` na leitura, `setCookie()`/`deleteCookie()` na escrita — verificados
como exportados por `@tanstack/react-start/server` na versão 1.168.38 instalada).

`obterUsuario()` usa **`auth.getUser()`, nunca `auth.getSession()`**. O `getSession()`
apenas decodifica o JWT presente no cookie, então um cookie forjado passaria; o
`getUser()` valida contra o servidor do Supabase. A autorização inteira do app depende
desta escolha.

Dois middlewares, em `src/lib/auth/middleware.ts`:

- **`exigirSessao`** — chama `obterUsuario()`, responde 401 se não houver, injeta o
  usuário no contexto.
- **`registrarErros`** — loga a exceção com o nome da função e repropaga (o
  `logServerFnErrors` do CPI).

⚠️ **Por que `middleware.ts` e não `middleware.server.ts`:** middlewares são
referenciados fora do handler, no encadeamento `.middleware([...])`, então o módulo entra
no bundle do cliente — só o corpo do `.server()` é removido. O sufixo `.server.ts` na
convenção deste projeto significa "nunca chega ao cliente", e usá-lo aqui seria um nome
mentindo sobre o que o arquivo faz. Consequência prática: dentro do `.server()`, o acesso
a `sessao.server.ts` é por `await import()`, igual aos handlers.

**Por que o middleware é a fronteira de segurança:** as server functions usam o client de
service role, que passa por cima do RLS. Uma função que esqueça `.middleware([exigirSessao])`
é um endpoint público de escrita no banco. Por isso existe um teste que trata isso como
invariante (ver Testes).

Fluxo:

- `/login` — e-mail e senha; erro sempre genérico ("e-mail ou senha inválidos"), sem
  revelar qual campo falhou.
- `_app.tsx` — `beforeLoad` verifica a sessão e faz `redirect({ to: "/login" })` quando
  não há. Toda rota do CRM é filha dele, então nenhuma tela fica desprotegida por
  esquecimento.
- Sair — limpa os cookies e volta ao login.

**Ação manual necessária no painel do Supabase:** desabilitar "Enable signups". Sem isso
o endpoint `/auth/v1/signup` continua aberto e qualquer pessoa cria uma conta que o
`eh_dono()` aceita, já que ele só exige `auth.uid() is not null`.

## Contrato das server functions

**Leitura**

| Função | Fonte | Polling |
| --- | --- | --- |
| `listarConversasDoInbox()` | `listarConversas(admin, 50)` | 5s |
| `listarMensagensDaConversa({ conversaId })` | `listarMensagens` | 5s, só com a conversa aberta |
| `obterLeadDoCrm({ leadId })` | `obterLead` | sem polling; recarrega após edição |
| `listarTarefasDoCrm({ apenasAbertas })` | `listarTarefas` | 5s |
| `obterUrlDeMidia({ mensagemId })` | Storage | cache de 4 min |

`listarConversas` já foi escrita para este inbox: devolve `nome, telefone, estagio,
precisa_atencao, nao_perturbe, nao_lidas, ultima_mensagem_em, ultima_mensagem_preview,
ultima_mensagem_direcao` e a conversa aninhada com `pausada_pela_ia`, `followup_toque` e
`ciclo_pausado_ate`.

**Escrita**

- `responderNoInbox({ conversaId, leadId, texto })`
- `devolverParaIa({ conversaId })` / `pausarIaNaConversa({ conversaId })`
- `marcarConversaLida({ leadId })` / `resolverAtencao({ leadId })`
- `moverEstagioDoLead({ leadId, estagio })`
- `atualizarDadosDoLead({ leadId, campos })`
- `registrarNotaNoLead({ leadId, texto })`
- `alternarNaoPerturbe({ leadId, ... })`
- `criarTarefaDoCrm` / `alternarTarefaDoCrm` / `excluirTarefaDoCrm`
- `reenviarMensagem({ mensagemId })`

`entrar` e `sair` ficam em `auth.functions.ts` e são as **únicas** sem `exigirSessao` —
as duas exceções que o teste do invariante conhece nominalmente.

### Regras de comportamento

**Responder pausa a IA na mesma ação.** `responderNoInbox` executa `pausarIa` →
`enviarTextoDoCrm(remetente: "humano")` → `marcarLida`, nessa ordem. Pausar primeiro
importa: na ordem inversa, um worker que acordasse no meio poderia entregar ao lead a
mensagem humana e a da IA quase juntas, possivelmente se contradizendo. Não existe botão
separado de "pausar antes de responder".

**O telefone vem do banco, nunca do cliente.** A função recebe `conversaId`, `leadId` e
`texto`; ela mesma busca o telefone do lead. Como o handler roda com service role,
aceitar telefone vindo do navegador transformaria o inbox num disparador de WhatsApp para
número arbitrário.

**Erro de envio é visível.** `enviarTextoDoCrm` não lança: devolve `{ ok, erro }` e deixa
a linha com `status = "falhou"`. A tela mostra a mensagem em vermelho com "não entregue"
e um botão de reenviar.

**Mídia por URL assinada.** `obterUrlDeMidia` lê o `media_path` do banco a partir do
`mensagemId` e devolve uma URL assinada de 5 minutos para o bucket privado `crm-midia`.
O caminho jamais vem do cliente — seria leitura arbitrária do bucket.

## Telas

**Barra superior:** nome do app, contador de leads com `precisa_atencao` (clicável, aplica
o filtro na lista), link para a fila de tarefas com a contagem de abertas, e sair.

**Coluna esquerda (~340px) — lista de conversas.** Por linha: nome (ou telefone, quando o
lead ainda não se apresentou), prévia da última mensagem, hora, badge de estágio, bolinha
de não lidas, ⚠️ para `precisa_atencao`, 🔇 para `nao_perturbe`, e o indicador
**"IA respondendo" vs "você assumiu"**. Filtros: todas · precisam de atenção · você
assumiu.

**Coluna central — a conversa.** Cabeçalho com nome, telefone, estado da IA e o botão que
alterna assumir/devolver.

Histórico em bolhas com **três aparências distintas**: lead à esquerda; IA à direita;
humano à direita, visualmente separado da IA. Distinguir IA de humano de relance evita
repetir ou contradizer o que a IA já disse.

Por tipo de mensagem:

- texto — direto;
- áudio — player mais a transcrição abaixo; `transcricao_status = "failed"` exibe "não foi
  possível transcrever";
- imagem — miniatura que abre em tamanho maior;
- documento — link;
- `status = "falhou"` — em vermelho, "não entregue", com botão de reenviar.

Rodapé: caixa de resposta. Enquanto a IA está ativa, exibe antes do envio: "Ao responder,
você assume a conversa e a IA para".

**Coluna direita (~340px) — o lead.** Estágio em select alimentado por `ESTAGIOS` e
`camposDeTransicao` (já existentes em `src/lib/crm/estagios.ts`), dados capturados,
máquina de interesse, comissão estimada e confirmada, anúncio de origem quando houver,
notas e tarefas daquele lead. Quando o lead está com `precisa_atencao`, um aviso no topo
da coluna explica que a IA escalou, com o botão que chama `resolverAtencao` e devolve o
lead ao fluxo normal.

**Fila de tarefas (`/tarefas`).** Tela simples, uma coluna: todas as tarefas abertas
ordenadas por vencimento, cada uma com link para a conversa do lead. Criar, concluir e
excluir acontecem tanto aqui quanto no painel do lead, pelas mesmas server functions. É a
lista que responde "o que ficou pendente comigo", que a lista de conversas — ordenada por
atividade — não responde.

## Erros e casos-limite

**A corrida entre o operador e o worker.** `executarTurno` lê `pausada_pela_ia` no início
e decide via `decidirTurno`. Entre essa checagem e o envio há a chamada ao modelo —
segundos, e mais de dez quando há tools. Uma resposta manual nessa janela chega tarde: a
IA envia a dela depois, e o lead vê duas vozes se atropelando.

O defeito não existia antes porque não havia como pausar. A correção pertence a esta
fatia: **reler `pausada_pela_ia` imediatamente antes do envio e abortar o turno se tiver
mudado.** É a única alteração prevista em `agente.server.ts`. A alternativa (avisar na UI
que a IA está gerando) documenta o problema em vez de resolvê-lo.

Resta uma janela mínima entre o recheck e o `POST` para a UAZAPI. É aceita: sair de dez
segundos para milissegundos é a diferença entre acontecer toda semana e não acontecer.

**Lead sem telefone (`@lid`).** `enviarTextoDoCrm` devolve "lead sem telefone". A caixa de
resposta fica desabilitada com a explicação visível, em vez de aceitar um texto que
morreria no envio.

**Sessão expirada durante o uso.** A server function devolve 401 e o cliente redireciona
para `/login` **preservando o texto digitado**, voltando à mesma conversa depois do login.

**Aba em segundo plano.** O polling para quando a aba perde visibilidade e dispara um
refetch imediato ao voltar.

**Conversa longa.** Limite de 50 mensagens, com "carregar mais antigas".

**UAZAPI indisponível.** A mensagem fica `falhou` e visível na conversa; o reenvio é
manual pelo botão.

## Testes

Runner nativo do Node (`node --test --experimental-strip-types "src/**/*.test.ts"`), com a
restrição conhecida: módulos testados não podem importar `@/...` no topo.

As server functions são finas e dependem do runtime do TanStack, então os testes miram
onde há lógica:

1. **Invariante de autorização** — lê `crm.functions.ts`, encontra toda ocorrência de
   `createServerFn` e falha se alguma não estiver encadeada com `exigirSessao`; `entrar` e
   `sair` são exceções nominais. É o teste de maior retorno da fatia.
2. **`responderNoInbox`** com deps injetadas: pausa antes de enviar; telefone lido do banco
   e não do argumento; erro de envio resultando em `falhou`.
3. **Recheck de pausa** — um turno que começa despausado e é pausado antes do envio não
   envia nada.
4. **Adaptador de sessão** — `obterUsuario()` devolve `null` sem cookie e quando o
   `getUser()` recusa.

Componentes React não recebem teste automatizado nesta fatia: o runner nativo não tem DOM
e montar essa infraestrutura custa mais do que rende aqui. A verificação da UI é manual,
por roteiro escrito no plano de implementação: logar, ver a lista, abrir conversa,
responder, confirmar que a IA pausou, devolver o controle, mover estágio, abrir uma
conversa com áudio e uma com imagem.

## Decisões que afetam fatias vizinhas

**A Fatia 3 deixa de ser RAG.** O spec mestre previa pgvector, chunks, embeddings e uma
tool `buscar_base_conhecimento`. A medição feita em 2026-08-08 mostra que isso resolveria
um problema que não existe:

- `src/lib/agente/conhecimento.ts` tem 22,5 KB destilados dos 174 KB de manuais em
  `docs/conhecimento/`, e o prompt injeta o bloco inteiro conforme o modo
  (`CONHECIMENTO_VENDA` ou `CONHECIMENTO_POS_VENDA`). São ~3–4 mil tokens por turno.
- Dos sete manuais, apenas três são conhecimento de atendimento (`produtos-e-taxas.md`,
  `vendas-e-objecoes.md`, `pos-venda-e-suporte.md`) e os três já estão destilados. Dos
  outros quatro: `links-verificados.md` já vive em `links.ts` como código;
  `comissao-por-maquina.md` é marcado "nunca mostrar ao cliente final" e não pode entrar
  no prompt; `gerador-de-mensagens.md` e `capi-replicacao-cpi.md` são pesquisa e
  engenharia, não atendimento.

Nesse tamanho, RAG é um downgrade: troca "a IA vê 100% da base todo turno" por "a IA vê o
que a busca recuperar", e a busca erra justamente em pergunta de taxa. Também eliminaria o
teste que extrai todo percentual e todo valor em reais do `conhecimento.ts` e os confere
contra os manuais — o guardrail que impede a IA de inventar preço.

**Fatia 3 redefinida:** tabela `base_conhecimento` com os blocos atuais como linhas, tela
de edição, e o servidor concatenando os documentos ativos e injetando-os **inteiros** no
prompt, como já faz. O ganho pretendido (corrigir uma taxa sem commit e sem deploy) é
preservado; o teste dos números passa a rodar contra o banco. Sem pgvector, sem
embeddings, sem chunk. Ela vem depois desta fatia, reaproveitando login e layout.

RAG volta à mesa quando a base não couber mais no prompt — algo como 15 a 20 vezes o
tamanho atual.
