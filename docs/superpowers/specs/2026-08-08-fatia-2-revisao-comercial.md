# Fatia 2 — Revisão comercial (adendo)

**Data:** 2026-08-08
**Status:** Aprovado pelo dono
**Substitui** o que conflitar em `2026-08-08-fatia-2-agente-crm-design.md`.

O dono trouxe o material comercial real da Ton (~35 documentos em
`C:\Users\Pedro Deyvson\Downloads\TON`) e os links de indicação. Isso inverte quatro
decisões e amplia o escopo do agente de "qualifica e manda link" para **vendedor completo,
do primeiro contato ao pós-venda**.

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

### 3. Régua de follow-up de 5 toques (decisão do dono)

Cadência com espaçamento crescente: **24h → 3 dias → 7 dias → 14 dias → 30 dias**. Cada
toque com ângulo diferente, nunca repetindo o anterior:

| Toque | Ângulo |
|---|---|
| 1 (24h) | "Conseguiu concluir o cadastro? Travou em alguma parte?" |
| 2 (3d) | Descobrir a objeção — pergunta o que pesou na decisão |
| 3 (7d) | Quebrar a objeção mais provável pelo que se sabe do lead |
| 4 (14d) | Urgência: condição/desconto vigente (só se o material trouxer condição real) |
| 5 (30d) | Última chamada, leve, deixando a porta aberta |

Depois do toque 5 o lead vira `perdido` e a IA nunca mais inicia conversa com ele.

> **Risco registrado.** Eu recomendei 3 toques; o dono escolheu 5+. A instância UAZAPI é
> **compartilhada com o CPI**, então uma marcação de spam derrubaria os dois projetos. Três
> travas técnicas obrigatórias reduzem esse risco:
>
> 1. **Qualquer resposta do lead cancela a régua inteira** — o reagendamento por mensagem
>    recebida já faz isso; a régua só continua no silêncio absoluto.
> 2. **Opt-out permanente:** se o lead pedir para parar ("para", "não quero mais", "me tira
>    da lista", "sai"), grava `nao_perturbe = true` e nenhum follow-up dispara nunca mais,
>    em nenhum estágio. Escala para o Pedro.
> 3. **Espaçamento crescente**, nunca dois toques na mesma semana depois do terceiro.

### 4. Pós-venda guiado pelos documentos

A IA acompanha o cliente **depois** da compra: cadastro, documentação, KYC, abertura de MEI,
ativação da máquina, chave Pix, voucher/cupom — tudo que `docs/conhecimento/pos-venda-e-suporte.md`
cobre.

**Escala para o canal oficial da Ton:** conta bloqueada, dinheiro que não caiu, defeito de
máquina, estorno. É o que o próprio material do programa manda fazer.

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

## O que isso muda no plano de implementação

| Tarefa | Mudança |
|---|---|
| 1 | Já feita. Precisa de **migração complementar**: `leads.nao_perturbe`, `conversas.followup_toque` (0–5). A coluna `followup_enviado` vira redundante mas fica (renomear quebraria código já escrito) |
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
