# Fatia 2 — Revisão comercial (adendo)

**Data:** 2026-08-08
**Status:** Aprovado pelo dono
**Substitui** o que conflitar em `2026-08-08-fatia-2-agente-crm-design.md`.

O dono trouxe o material comercial real da Ton (~35 documentos em
`C:\Users\Pedro Deyvson\Downloads\TON`) e os links de indicação. Isso inverte quatro
decisões e amplia o escopo do agente de "qualifica e manda link" para **vendedor completo,
do primeiro contato ao pós-venda**.

## 0. A persona: Mika, vendedora (não assistente)

**Ela não é assistente de ninguém.** O design original a tratava como "o assistente do Pedro",
que fala em nome dele. Está errado, e o dono corrigiu: para o cliente, **ela é a pessoa que
está atendendo**. Vendedora, não recepcionista, não secretária, não "posso te encaminhar".

- **Nome:** Mika. **Gênero:** feminino — "a Mika", "sou consultora", concordância feminina em
  tudo que ela diz sobre si.
- **Papel:** consultora parceira da Ton. Continua valendo a regra do programa: **nunca** se
  apresenta como funcionária da Ton.
- **Postura:** perfil de vendedora. Ela está ali para vender a maquininha — conduz a conversa,
  faz as perguntas de qualificação, contorna objeção e fecha. Não fica esperando o cliente
  pedir; não devolve pergunta com pergunta genérica; não age como intermediária de outra
  pessoa.

**Nunca diz** "vou passar para o Pedro", "meu chefe", "a pessoa responsável", "sou uma IA",
"sou um assistente virtual". Quando escala, ela diz que vai confirmar e retorna — porque quem
volta é ela mesma.

Isso não muda a mecânica de escalação: `precisa_atencao` e `pausada_pela_ia` continuam
idênticos, e o Pedro assume pelo inbox. Do lado do cliente, quem responde continua sendo a
Mika — por isso mensagem com `remetente = "humano"` entra no histórico do modelo como
`assistant`, na mesma voz.

## Decisões que mudam

### 1. A IA fala taxa (inverte a decisão anterior)

Antes: toda pergunta de taxa escalava, e nenhum número entrava na base.
**Agora:** a IA responde taxa usando os números da tabela oficial extraída de
`tabela_taxas_rex.pdf` e `tabela-adesao-rex.pdf`, reproduzidos em
`docs/conhecimento/produtos-e-taxas.md`.

Motivo: taxa é a primeira pergunta de todo dono de comércio. Sem responder, a IA trava
exatamente onde converteria. O risco cai porque o número vem do documento, não do modelo.

**Escala quando:** o cliente pede negociação especial, uma faixa de faturamento que não
consta na tabela, ou qualquer condição marcada `NÃO CONSTA NO MATERIAL` no manual.

O teste que proibia percentual no arquivo de conhecimento **sai**. Entra outro: os números
do manual têm que casar com os da tabela de origem.

### 2. Um link por máquina, gerado por template (substitui `TON_LINK_INDICACAO`)

Não existe um link só. Existe um link de catálogo e um link de checkout por produto, todos
carregando o mesmo `referrer` do Pedro.

```
TON_REFERRER = CEA4255F-0783-4EAD-AA55-48C682BA8FA7

catálogo:  https://ton.com.br/catalogo/?referrer={REF}&userAnticipation=0
                &utm_medium=invite_share&utm_source=revendedor

checkout:  https://ton.com.br/checkout/cart/?productId={PRODUCT_ID}&referrer={REF}
                &userAnticipation=0&userTag={TIER}
                &utm_medium=invite_share&utm_source=revendedor
```

| `productId` | `userTag` |
|---|---|
| `TONBLACK_TIER_SMART_POS` | `tonblack_tier` |
| `TONMEGA_TIER_SMART_POS` | `tonmega_tier` |
| `TONMEGA_TIER_S920` | `tonmega_tier` |
| `TONMEGA_TIER_D195` | `tonmega_tier` |
| `TONMEGA_TIER_D150` | `tonmega_tier` |

O nome comercial de cada `productId` sai de `docs/conhecimento/produtos-e-taxas.md`, que é
extraído de `guia_maquinas.pdf` — **não deduza o modelo pelo código do hardware**.

Só o `referrer` vai para variável de ambiente (`TON_REFERRER`). O resto é tabela em código:
são identificadores de produto, não segredo, e versioná-los deixa o mapa revisável.

**A tool muda:** `registrar_link_enviado` passa a receber `produto` — um dos `productId`
acima ou `catalogo`. Ela monta o link pelo template e o devolve. O modelo continua sem nunca
escrever URL: agora ele só escolhe **qual** máquina.

Quando o cliente ainda não decidiu, a IA manda o **catálogo**. Quando já decidiu, manda o
checkout do produto — que é o link que converte melhor, porque cai direto no carrinho.

### 3. Régua de follow-up: a cadência oficial da Ton

A primeira versão desta decisão foi 5 toques em 30 dias, escolha do dono. A extração de
`urgencia_remarketing.pdf` mostrou que **o próprio programa Renda Ton define a cadência** e
trata desvio como infração — o material chama frequência sem cadência de *"perseguição
(contra diretrizes)"*. O dono reviu a decisão à luz do documento e adotou a cadência oficial.

**Ciclo de remarketing: 4 toques, contados a partir do envio do link.**

| Toque | Quando | Ângulo |
|---|---|---|
| 1 | dia 0 (+24h do link) | "Conseguiu concluir o cadastro? Travou em alguma parte?" |
| 2 | +2 dias | Descobrir a objeção — pergunta o que pesou |
| 3 | +5 dias | Quebrar a objeção mais provável pelo que se sabe do lead |
| 4 | +10 dias | Última do ciclo — prova social ou benefício ainda não citado |

Sem resposta no toque 4: **pausa obrigatória de 30 dias**. Passados os 30, um novo ciclo pode
começar, desde que o lead nunca tenha pedido para parar.

**Regra dura do material — cada toque precisa de motivo novo.** Repetir o argumento anterior
é o que o documento proíbe. Isso vai para o prompt: o ângulo de cada toque entra na instrução
do turno, e o histórico completo vai junto para o modelo não se repetir.

**Urgência falsa é proibida.** O material é explícito: não dizer que um cupom acaba se ele
segue vigente. O toque 4 só usa condição com prazo se `docs/conhecimento/produtos-e-taxas.md`
trouxer uma condição realmente datada — por isso a extração marca essas com
`⚠️ VERIFICAR VALIDADE`.

Três travas técnicas, mantidas:

1. **Qualquer resposta do lead cancela o ciclo** — o reagendamento por mensagem recebida já
   faz isso; a régua só avança no silêncio absoluto.
2. **Opt-out permanente:** se o lead pedir para parar ("para", "não quero mais", "me tira da
   lista"), grava `nao_perturbe = true`, nenhum follow-up dispara nunca mais em nenhum
   estágio, e escala para o Pedro.
3. **Um toque por dia, no máximo** — trava de segurança contra bug de agendamento, não
   contra o desenho.

### 4. Pós-venda guiado pelos documentos

A IA acompanha o cliente **depois** da compra: cadastro, documentação, KYC, abertura de MEI,
ativação da máquina, chave Pix, voucher/cupom — tudo que `docs/conhecimento/pos-venda-e-suporte.md`
cobre.

**A IA tenta resolver primeiro. Encaminhar é o último passo, não o primeiro.**

Ordem obrigatória diante de qualquer problema pós-venda:

1. **Tenta resolver** com o que os documentos cobrem. O material tem orientação para conta
   bloqueada (`One Page bloqueio`), cadastro pendente, voucher que não aplicou, documentação
   recusada, ativação, chave Pix. A IA usa isso e conduz o cliente passo a passo.
2. **Confirma se resolveu.** Pergunta se funcionou. Não presume.
3. **Só então encaminha**, e apenas quando: a tentativa não resolveu, o problema não está em
   nenhum documento, ou o próprio material manda encaminhar.

Encaminhar de cara um problema que o material ensina a resolver é o erro a evitar — o
programa é explícito em não sumir quando a máquina do cliente dá problema.

**O canal oficial** (informado pelo dono — o material extraído não trazia; a extração marcou
corretamente como `NÃO CONSTA NO MATERIAL` em vez de inventar):

> **App da Ton** ou **https://ajuda.ton.com.br/**

A IA sempre entrega o canal junto com a escalação — nunca diz só "procure o suporte da Ton".
O material é explícito em não abandonar o cliente quando a máquina dá problema, e mandar
alguém procurar um canal sem dizer qual é abandono com outro nome.

Isto substitui a regra anterior "reclamação e pós-venda sempre escalam" — agora só a parte
que é da Ton escala.

### 5. Confirmação de compra é pela palavra do lead

Não há integração que diga se a venda aconteceu — a Ton não expõe isso. A confirmação vem da
conversa: o lead diz que comprou, ou diz que não.

**Nova tool `registrar_resultado_compra(resultado, detalhe?)`:**

| `resultado` | Efeito |
|---|---|
| `comprou` | Estágio → `convertido`, cancela a régua de follow-up, libera o modo pós-venda |
| `nao_comprou` | Estágio → `contornando_objecao`, grava o motivo em `eventos_lead`, **a IA tenta quebrar a objeção na hora** em vez de desistir |
| `nao_perturbe` | `nao_perturbe = true`, encerra a régua para sempre, escala |

O `nao_comprou` é o ponto de maior valor da fatia: é onde o lead diz o que travou, e é onde
o manual de objeções entra.

## 6. Funil do Kanban e eventos da Meta por etapa

O CRM existe para alimentar tráfego pago: cada avanço no funil vira um evento na Meta, e o
algoritmo passa a otimizar por quem realmente compra, não por quem só conversa.

**Metade disso já existe.** A Fatia 1 implementou `src/lib/capi/capi.server.ts` e a tabela
`eventos_capi` nasceu com exatamente os quatro nomes no check. `LeadSubmitted` já dispara em
produção. Falta ligar os outros três às transições de estágio.

### Mapeamento estágio → evento

Os 8 estágios internos ficam; o Kanban agrupa em 4 colunas na tela. O sistema raciocina com
8 (a Mika precisa saber a diferença entre *apresentando solução* e *contornando objeção*), o
dono vê 4.

| Estágio interno | Coluna do Kanban | Evento na Meta |
|---|---|---|
| `novo` | Novo | `LeadSubmitted` *(já dispara hoje, no ingest)* |
| `qualificando` | Novo | — (transição, não dispara) |
| `apresentando_solucao` | Qualificado | `QualifiedLead` |
| `contornando_objecao` | Qualificado | `QualifiedLead` *(dedup: não reenvia)* |
| `link_enviado` | Interesse | `InitiateCheckout` |
| `acompanhamento` | Interesse | — (já disparou no link) |
| `convertido` | Venda | `Purchase` |
| `perdido` | — (fora do Kanban) | — |

O disparo acontece dentro de `moverEstagio`, não espalhado pelo código: uma transição, um
evento, um lugar só.

### Valor do `Purchase`

Vai a **comissão estimada** do lead (`leads.comissao_estimada`), em BRL — é a receita real da
venda para o dono, então a Meta otimiza pelo que paga. Quando o campo estiver vazio, cai num
padrão configurável (`COMISSAO_PADRAO_BRL`). Sem valor, a Meta otimizaria por volume de
conversa, que é o sinal mais fraco disponível.

### Limite honesto: só lead de anúncio gera evento

O CAPI em modo `business_messaging` depende do `ctwa_clid`, que só chega em lead vindo de
anúncio clique-para-WhatsApp. **Lead orgânico não tem atribuição e não gera evento** — a Meta
rejeitaria. O Kanban funciona igual para todo mundo; só o disparo é restrito.

Isso não é limitação nova desta fatia: é como o `LeadSubmitted` já se comporta hoje.

### Deduplicação

A Meta **não** deduplica eventos de business messaging. A dedup é nossa, pela tabela
`eventos_capi` (`lead_id` + `nome_evento` com `status_resposta = "ok"`), que já existe e já é
usada pelo `LeadSubmitted`. Um lead que vai e volta entre `apresentando_solucao` e
`contornando_objecao` gera **um** `QualifiedLead`, não vários.

### A Mika move o lead

Ela já tem a tool `atualizar_lead` com o argumento `estagio`. Como o disparo mora dentro de
`moverEstagio`, ela alimenta o Meta Ads sem saber que faz isso — não há tool de CAPI, não há
como ela disparar um evento errado, e não há como esquecer.

**Falha de CAPI nunca custa a conversa:** `try/catch` e `console.warn`, mesmo princípio já
usado no `ingest.server.ts`.

## O que isso muda no plano de implementação

| Tarefa | Mudança |
|---|---|
| 1 | Já feita. Precisa de **migração complementar**: `leads.nao_perturbe`, `conversas.followup_toque` (0–4), `conversas.ciclo_pausado_ate`. A coluna `followup_enviado` vira redundante mas fica (renomear quebraria código já escrito) |
| 10 | `conhecimento.ts` deixa de ser esqueleto: passa a carregar os três manuais destilados. Sai o teste que proíbe percentual; entra o que confere os números contra a tabela |
| 12 | `registrar_link_enviado` ganha o argumento `produto`; entra `registrar_resultado_compra`; entra o módulo `links.ts` com o template e o mapa |
| 13 | O turno ganha o modo pós-venda e o gatilho de cada toque da régua |
| 14 | O worker calcula o próximo toque pela tabela de cadência, não por um único `FOLLOWUP_HORAS` |
| 16 | Golden set cresce: casos de taxa respondida corretamente, escolha de máquina por perfil, quebra de objeção, opt-out |
| **nova** | Task de `links.ts` + manuais de conhecimento, antes da 10 |

## Variáveis de ambiente (revisadas)

| Variável | Valor |
|---|---|
| `TON_REFERRER` | `CEA4255F-0783-4EAD-AA55-48C682BA8FA7` |
| `OPENAI_MODEL` | `gpt-5.4-mini` |
| `AGENTE_ATIVO` | `true` |
| `AGENTE_DEBOUNCE_MS` | `8000` |

`TON_LINK_INDICACAO` **sai** — substituída pelo template + mapa de produtos.
`FOLLOWUP_HORAS` **sai** — substituída pela tabela de cadência.
