# Fatia 6 — revisão comercial da Mika

Base: specs `docs/superpowers/specs/2026-08-08-fatia-6-revisao-comercial-notas.md`
(seções 1–11 — leia antes de implementar qualquer task; é onde está o PORQUÊ de
cada regra, com caso real do banco por trás). Branch nova a partir de `main`
com o que está em `fatia-4-crm-inbox` já mesclado, ou branch nova a partir de
`fatia-4-crm-inbox` — decisão do controlador no momento de abrir.

## Objetivo

O foco é conversão, não conformidade (spec §9 — reenquadramento do dono). Cada
task abaixo existe porque uma conversa real do banco mostrou o defeito.

## Descobertas que mudam o desenho, feitas ao escrever este plano

- **`ANGULO_DO_TOQUE` já existe** (`src/lib/agente/conhecimento.ts:405-418`) —
  é a escada de 4 ângulos para a régua OFICIAL pós-link (1,2,5,10 dias). O
  resgate pré-link (1h/3h/6h/12h) é uma cadência DIFERENTE e SEPARADA — precisa
  da própria constante, `ANGULO_DO_RESGATE`, e do próprio contador no banco.
  **Não reusar `followup_toque`**: ele tem `check between 0 and 4` e é contado
  pela régua oficial — reusar esgotaria a régua real antes dela começar.
- **`ModoDoAgente = "venda" | "pos_venda"` já existe**
  (`src/lib/agente/prompt.ts:16`). Os "3 modos" da spec (§8.1) mapeiam nele:
  VENDA + CONFIRMAÇÃO = `"venda"`, SUPORTE = `"pos_venda"`. Não é preciso
  inventar um terceiro valor — é preciso decidir CORRETAMENTE quando trocar de
  um para o outro, o que hoje depende só de `estagio`, sem confirmação de
  compra.
- **`registrarFalha` já existe** (`src/lib/crm/conversas.server.ts:154-171`),
  mas mede falha TOTAL com backoff exponencial — não distingue "o WhatsApp
  recusou por causa do destinatário" (bloqueio) de falha transitória (rede,
  rate limit). É a lacuna do CPI (spec §5, `followup-falhas.ts`) que ainda não
  temos.

## Global Constraints

- `bun run test` sem falhas novas; baseline no início desta fatia: confira com
  `bun run test 2>&1 | tail -8` antes da Task 1 e registre o número no ledger.
- `bunx tsc --noEmit`: baseline conhecido de 7 erros pré-existentes em
  `.test.ts`. Critério: nenhum erro NOVO.
- `git add` com caminhos explícitos, nunca `git add -A`.
- **Todo lead no banco de produção é real.** Nenhuma verificação manual pode
  mover estágio de lead real (dispara CAPI) nem mandar mensagem real. Use
  fixtures/dublês para teste automatizado; para manual, leads de teste
  criados e removidos na própria sessão.
- Migrations seguem o padrão `YYYYMMDDx_descricao.sql` já em uso
  (`supabase/migrations/`). Aplicar via `mcp__plugin_supabase_supabase__apply_migration`
  e também deixar o arquivo no repo (as duas coisas, como nas migrations
  anteriores desta base).
- Módulos puros (sem I/O) ficam sem sufixo `.server`; o que toca `admin` ou
  `process.env` leva `.server.ts`. Padrão já em uso em todo `src/lib/`.

---

## Task 1 — Migrations: contador de resgate, compra confirmada, falha do destinatário, log de turno

**Files:**
- Create: `supabase/migrations/20260809_fatia6_resgate_e_confirmacao.sql`

**Colunas em `conversas`:**
- `resgate_toque smallint not null default 0 check (resgate_toque between 0 and 4)`
  — contador PRÓPRIO do resgate pré-link, independente de `followup_toque`.
- `resgate_pausado_ate timestamptz` — mesmo papel de `ciclo_pausado_ate`, mas
  para o resgate (evita resgate infinito se o worker não avançar o contador).
- `falhas_destinatario smallint not null default 0` — consecutivas; qualquer
  envio bem-sucedido zera.

**Colunas em `leads`:**
- `compra_confirmada_em timestamptz` — null até o lead confirmar EXPLICITAMENTE
  ("comprei", "finalizei", "fiz o cadastro"). É o que decide VENDA/CONFIRMAÇÃO
  vs SUPORTE (spec §8.1). Não é o mesmo que `estagio = 'convertido'`: hoje esse
  campo é setado sem confirmação (achado da revisão final, Minor 9 do relatório
  da branch anterior) — esta migration não conserta isso sozinha, só dá o
  campo; a Task 4 usa.

**Tabela nova `turnos_agente`** (log de turno — spec §6/§11 item "ciclo de
aprendizado", parte 1: só a captura, sem destilação nesta fatia):
```sql
create table public.turnos_agente (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  origem text not null check (origem in ('resposta_lead','followup','resgate')),
  status text not null check (status in ('concluido','erro','escalado')),
  tokens_entrada int,
  tokens_saida int,
  tokens_cache int,
  tools_usadas text[],
  erro text,
  criado_em timestamptz not null default now()
);
create index turnos_agente_lead_id_idx on public.turnos_agente (lead_id, criado_em desc);
alter table public.turnos_agente enable row level security;
create policy turnos_agente_operador on public.turnos_agente for all using (eh_dono()) with check (eh_dono());
```
Nota: `eh_dono()` já existe e já é o padrão certo, pós-correção da Fatia 4
(commit `5f69482` na branch anterior).

- [ ] **Step 1: Escrever e aplicar a migration** (as duas: arquivo + `apply_migration`)
- [ ] **Step 2: Conferir `bunx tsc --noEmit` inalterado** (migration não gera tipo — mas se algum código já referenciar as colunas novas, faça-o DEPOIS desta task, não nesta)
- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/20260809_fatia6_resgate_e_confirmacao.sql
git commit -m "feat(fatia6): colunas de resgate pré-link, compra confirmada e log de turno"
```

---

## Task 2 — Régua de resgate pré-link + janela de silêncio (puro)

**Files:**
- Create: `src/lib/crm/resgate.ts`
- Create: `src/lib/crm/resgate.test.ts`
- Create: `src/lib/crm/horario-followup.ts`
- Create: `src/lib/crm/horario-followup.test.ts`

**`resgate.ts`** — espelha a forma de `regua.ts` (mesmo repo, já lido):
```ts
export const MINUTOS_DO_TOQUE_RESGATE = [60, 180, 360, 720] as const; // 1h,3h,6h,12h
export const TOTAL_DE_TOQUES_RESGATE = MINUTOS_DO_TOQUE_RESGATE.length;

export type PlanoDoResgate =
  | { tipo: "toque"; toque: number; quandoIso: string }
  | { tipo: "encerrado" }; // sem pausa de 30 dias — decisão §9: não é regra fixa, é a régua oficial que assume depois do link

export function planejarProximoResgate(
  toqueAtual: number,
  primeiraMensagemEmMs: number,
  agoraMs: number,
): PlanoDoResgate
```
Contado a partir da PRIMEIRA mensagem do lead (não do clique no anúncio — a
saudação automática não conta, mesmo critério de `ehSaudacaoDeAnuncio` em
`estagios.ts`). Se `toqueAtual >= 4`, devolve `{tipo:"encerrado"}` — o resgate
não tem pausa de 30 dias porque a essa altura o lead já foi resgatado ou o link
já saiu (que transfere para a régua oficial).

**`horario-followup.ts`** — espelha `followup-horario.ts` do CPI, adaptado à
decisão do dono (spec §4, "Janela de silêncio 21h–08h"):
```ts
export const FUSO_FOLLOWUP = "America/Sao_Paulo"; // mesmo padrão de rotulos.ts
export const HORA_INICIO_JANELA = 8;  // volta a mandar às 8h
export const HORA_FIM_JANELA = 21;    // para de mandar às 21h

/** true se `quandoMs` cai dentro da janela de silêncio (21h-08h em SP). */
export function estaNaJanelaDeSilencio(quandoMs: number): boolean

/** Se `quandoMs` cai no silêncio, devolve o instante das 8h seguintes.
 *  Senão devolve `quandoMs` sem alteração. NUNCA perde o toque — desloca. */
export function proximaAberturaSeSilencio(quandoMs: number): number
```
Use `Intl.DateTimeFormat` com `timeZone` fixo (mesma técnica de
`rotulos.ts:diaEmSaoPaulo`) — não use `Date.getHours()`, que lê o fuso do
processo, não o de São Paulo.

- [ ] **Step 1**: Escrever os testes primeiro (regressão do caso real: lead
  que escreve 22:00 → toque de 1h vira 23:00 [ainda dentro, permitido], toque
  de 3h em 01:00 → desloca para 08:00; toque de 6h já cai em 08:15 direto).
- [ ] **Step 2**: Implementar até os testes passarem.
- [ ] **Step 3**: `bun run test`, `bunx tsc --noEmit`, commit.
```bash
git add src/lib/crm/resgate.ts src/lib/crm/resgate.test.ts src/lib/crm/horario-followup.ts src/lib/crm/horario-followup.test.ts
git commit -m "feat(fatia6): cadência de resgate pré-link e janela de silêncio (puro)"
```

---

## Task 3 — Ligar o resgate no fluxo do agente

**Files:**
- Modify: `src/lib/agente/agente.server.ts`
- Modify: `src/lib/agente/tools.ts` (o corte em `registrar_link_enviado` já
  feito na Fatia 4 — commit `c478ac1` — passa a ter uma saída SEM escalar:
  ativar o resgate em vez de só recusar)
- Modify: `src/lib/agente/conhecimento.ts` (nova constante `ANGULO_DO_RESGATE`)
- Create/modify: teste correspondente a cada arquivo tocado

**`ANGULO_DO_RESGATE`** em `conhecimento.ts`, mesma forma de `ANGULO_DO_TOQUE`
mas com o conteúdo do resgate (spec §4, tabela, JÁ com SPIN aplicado — spec
§10.1/§11 item 1: cada toque pergunta Implicação ou Ganho, nunca reformula a
pergunta de Situação que já foi feita):
```ts
export const ANGULO_DO_RESGATE: Record<1 | 2 | 3 | 4, string> = {
  1: "...pergunta FECHADA (CPF ou CNPJ? já usa maquininha hoje?) — nunca repita a pergunta aberta já feita...",
  2: "...entrega valor sem pedir nada: recebimento na hora, Pix 0%, sem aluguel...",
  3: "...pergunta de IMPLICAÇÃO com o número que ele já deu, ou prova concreta se ele não deu número nenhum...",
  4: "...última chamada leve, sem pergunta, porta aberta...",
};
```
Escreva o texto de cada entrada olhando a spec §4 e §10.1 — não copie
verbatim daqui, isto é esqueleto.

**Integração em `agente.server.ts`**: quando um turno termina SEM que
`registrar_link_enviado` tenha sido chamado (ou foi chamado e recusado pela
guarda de evidência), e o lead ainda não tem `link_enviado_em`, agenda o
próximo toque de resgate via `planejarProximoResgate` + `proximaAberturaSeSilencio`,
gravando em `resgate_toque`/`responder_em`/`motivo_agendamento` — mesmo
mecanismo de `agendarToque`, mas para a coluna de resgate. Ao enviar o link,
`reiniciarCiclo` (já existe) precisa também zerar `resgate_toque` — confira se
já zera ou se precisa de ajuste.

`nao_perturbe` interrompe sempre (spec §4, "pontos de atenção" — invariante,
não muda). O resgate para no instante em que o lead responde: o gatilho é
SILÊNCIO, não tempo decorrido — o worker que processa `responder_em` já resolve
isso, porque toda mensagem nova do lead re-executa o turno.

- [ ] **Step 1**: Testes que provam: lead sem resposta → toque 1 agendado para
  1h depois, respeitando janela; lead que responde antes do toque → resgate
  cancelado (o turno normal roda); lead com `nao_perturbe` → resgate nunca
  agendado; 4º toque sem resposta → `resgate_toque` fica em 4, nada mais é
  agendado (sem pausa de 30 dias — diferente da régua oficial, ver Task 2).
- [ ] **Step 2**: Implementar.
- [ ] **Step 3**: `bun run test`, `bunx tsc --noEmit`, `bun run build`, commit
  com os caminhos exatos tocados.

---

## Task 4 — Três modos com confirmação real de compra

**Files:**
- Modify: `src/lib/agente/prompt.ts` (decisão de `ModoDoAgente`)
- Modify: `src/lib/agente/tools.ts` (`registrar_resultado_compra` grava
  `compra_confirmada_em` só quando `resultado === "comprou"` E o modelo citou
  confirmação explícita — ver abaixo)
- Modify: `src/lib/agente/conhecimento.ts` (bloco de instrução do modo
  CONFIRMAÇÃO, que hoje não existe — só há venda/pos_venda binário)
- Testes correspondentes

**A decisão de modo** (hoje: só `estagio` decide `venda` vs `pos_venda` —
achar o call site em `agente.server.ts` ou `prompt.ts` e confirmar) passa a
ser:
- `compra_confirmada_em` preenchido → `"pos_venda"` (SUPORTE completo).
- `link_enviado_em` preenchido e `compra_confirmada_em` vazio → `"venda"`,
  MAS com o bloco de instrução do modo CONFIRMAÇÃO acrescentado ao prompt
  (acompanhar ativamente: "conseguiu finalizar?" — spec §8.1). Isto é: o tipo
  `ModoDoAgente` não precisa de um terceiro valor, mas o CONTEÚDO do prompt em
  modo `"venda"` varia se o link já saiu ou não.
- Nenhum dos dois → `"venda"` puro, comportamento de hoje.

**Pedido de suporte ANTES da confirmação** (spec §8.2, o caso do lead que
perguntou de conta bloqueada e recebeu 4 mensagens de tutorial): no bloco de
instrução do modo `"venda"`, acrescentar a sequência de 4 tempos da spec —
posiciona, responde em 1 linha, reenquadra como argumento de fechamento, volta
ao fechamento. Isto é texto de prompt, não código de controle — vai em
`conhecimento.ts`, perto de `REGRAS_ESCALACAO`.

**`registrar_resultado_compra`**: hoje `resultado: "comprou"` já converte o
lead (`tools.ts:279` conforme a Fatia 4). Adicionar: só grava
`compra_confirmada_em` (e só então o modo vira `pos_venda`) se o `detalhe`
citar confirmação nas palavras do lead — a tool já pede `detalhe` como "o que
ele disse, nas palavras dele". Não é preciso NLP: a garantia é de prompt
(instrução: só chame `resultado: "comprou"` com confirmação EXPLÍCITA — "quero
essa" não é confirmação, spec §8.1) mais o teste automatizado provando que o
campo é gravado quando e só quando a tool é chamada com esse resultado.

- [ ] **Step 1**: Testes — modo continua "venda" com link enviado e sem
  confirmação (CONFIRMAÇÃO, não SUPORTE); vira "pos_venda" só após
  `registrar_resultado_compra("comprou")`; pedido de suporte antes da
  confirmação NÃO muda o modo (continua "venda", o prompt é que orienta a
  resposta).
- [ ] **Step 2**: Implementar.
- [ ] **Step 3**: Golden case novo em `casos-golden.ts` reproduzindo o caso
  real da spec §7 (lead `5521973174307`: "Quero essa" não pode virar suporte;
  "bloqueou minha conta" deve escalar, não ensinar a ativar).
- [ ] **Step 4**: `bun run test`, `bunx tsc --noEmit`, `bun run build`, commit.

---

## Task 5 — SPIN e fechamento assumido no prompt de venda

**Files:**
- Modify: `src/lib/agente/conhecimento.ts` (`RECOMENDACAO`, `OBJECOES` ou bloco
  novo — confira a constante certa lendo o arquivo)
- Teste: golden case cobrindo o caso da spec §2 (comparação de taxa)

Duas mudanças de instrução (spec §10.1, §10.5 — texto, não lógica):
1. Antes de recomendar produto, instruir Implicação ("quanto isso custa por
   mês no seu volume?") e Ganho ("o que muda pra você com isso resolvido?")
   quando o lead já deu Situação — não pular direto para a recomendação.
2. Depois que o lead já deu UM compromisso próprio (disse que quer, escolheu
   entre duas opções), trocar "quer que eu mande o link?" por fechamento
   assumido ("vou te mandar o link da T2 — só confirma CPF ou CNPJ").
   Condição explícita no texto: só depois de compromisso do lead, nunca antes
   (spec §10.5, "usar cedo demais é pressão").
3. Quando a taxa nominal perder para o concorrente: perguntar em quantos dias
   o concorrente paga, ANTES de comparar, e mudar de eixo para recebimento na
   hora / Pix 0% / sem aluguel em vez de admitir derrota e parar (spec §2/§9,
   decisão do dono).

- [ ] **Step 1**: Golden case reproduzindo a comparação de taxa da spec §2 —
  a resposta esperada NÃO pode ser "a taxa sobe" sem segundo movimento.
- [ ] **Step 2**: Ajustar o texto de `conhecimento.ts`.
- [ ] **Step 3**: `bun run test` (os casos golden rodam contra o modelo real —
  confirme como `casos-golden.ts` executa hoje antes de assumir), commit.

---

## Task 6 — Falha do destinatário: parar de insistir com quem bloqueou

**Files:**
- Modify: `src/lib/crm/conversas.server.ts` (nova função `registrarFalhaDeEnvio`
  ou extensão de `registrarFalha` — decidir olhando o call site)
- Modify: onde a uazapi é chamada para envio (achar via grep `enviarTextoDoCrm`
  ou similar) para classificar a resposta
- Teste correspondente

Espelha `followup-falhas.ts` do CPI (spec §5): status HTTP que a uazapi usa
para "o WhatsApp recusou esta mensagem" (buscar o valor real testando contra a
instância, como foi feito para `page_id` na Fatia 4 — não adivinhar). Após 3
falhas consecutivas DO DESTINATÁRIO (não transitórias), marcar a conversa como
`nao_perturbe`-like — decidir entre reusar `leads.nao_perturbe` (mais simples,
mas essa coluna hoje significa "o lead pediu") ou campo próprio
`bloqueio_suspeito boolean` (mais correto, porque a causa é diferente). Registre
a decisão no relatório da task.

- [ ] **Step 1**: Confirmar o status HTTP real (chamada de teste, como no
  diagnóstico do `page_id`).
- [ ] **Step 2**: Testes — 3 falhas de destinatário seguidas param o envio; 1
  falha de destinatário + 1 sucesso não acumula; falha transitória nunca conta.
- [ ] **Step 3**: Implementar, commit.

---

## Task 7 — Revisão final da fatia

Mesmo formato da revisão final da Fatia 4: um agente adversarial sobre a
branch inteira desta fatia, focado em (a) a régua de resgate não pode nunca
mandar mensagem no silêncio, (b) o modo pos_venda só liga com confirmação
real, (c) a trava de estágio da Fatia 4 continua cobrindo os caminhos novos
que este plano abriu (`registrar_resultado_compra` já cobria; confirme que
nada de novo escapou), (d) nenhuma migration ficou sem policy ou com policy
frouxa demais.

---

## Ordem de execução

Tasks 1 e 2 podem rodar em paralelo (migration não depende do código puro).
Task 3 depende de 1 e 2. Tasks 4, 5 e 6 podem rodar em paralelo entre si depois
da 3 (tocam arquivos diferentes: 4 e 5 tocam `prompt.ts`/`conhecimento.ts` —
CUIDADO, mesmo arquivo, sequenciar 4 antes de 5 ou dar briefs que não colidam
na mesma constante). Task 7 por último, sempre.
