# Links verificados — checkout Ton (visita real às páginas)

Este documento registra o que cada link de `src/lib/agente/links.ts` mostrou de
verdade quando visitado com navegador (Playwright), em 2026-08-08, usando o
referrer `CEA4255F-0783-4EAD-AA55-48C682BA8FA7` (conta do Pedro Ribeiro — a
página de checkout mostra "Indicado por: Pedro Ribeiro").

Regra seguida: só está escrito aqui o que a página mostrou. Onde a página não
mostrou algo, está marcado `NÃO VISÍVEL NA PÁGINA`. Nomes de modelo (T1/T2/T3/T3
Smart) foram lidos na própria página (catálogo e carrinho), não deduzidos do
código do produto.

Cruzamento feito com `docs/conhecimento/produtos-e-taxas.md` (fichas técnicas
dos modelos de hardware e tabela de adesão por nível de oferta) — citado onde
complementa o que a página mostrou.

---

## 0. Catálogo — `https://ton.com.br/catalogo/...`

**Nome exibido:** "Catálogo Ton" (título da página: *"Catálogo Ton: Maquininha
de cartão, cartão de débito, conta digital para o autônomo"*).

**Preço mostrado:** não é preço único — a página lista as 4 ofertas lado a lado
(T3 Smart, T3, T2, T1), cada uma com seu preço "de/por" e parcelamento (ver
seções abaixo, os valores batem com os das páginas de checkout individuais).

**Descrição / aparência:** página institucional com seção "Conheça os Planos
Ton" (comparador de taxas Maquininhas x TapTon), seção "Escolha sua Maquininha"
com os 4 cards de produto (imagem + nome + preço + botão "Pedir [modelo]" +
lista de specs), simulador de taxas, depoimentos de clientes e FAQ.

**Quando usar este link:** cliente que ainda não decidiu qual maquininha
quer — ele navega, compara preço e taxa dos 4 modelos e escolhe sozinho. Não é
a melhor opção quando o cliente já falou o que precisa (nesse caso, o link
direto do produto converte melhor, como o próprio código já observa).

---

## 1. TONBLACK_TIER_SMART_POS

**Nome comercial exato exibido no carrinho:** **"T3 Smart Ton Black"**

**Preço mostrado:** de R$ 699,43 por **R$ 189,00 à vista**, ou **12x de R$
15,75** (73% off). Faixa de taxas exibida na própria página ("Detalhes das
taxas"): Pix Grátis, Débito 2,28%, Crédito à vista 5,48%, Parcelado 12x 18,28%
— batem com a seção 2.4 (Ton Black) de `produtos-e-taxas.md`.

**Banner exibido:** "Oferta exclusiva para MEI e CNPJ" (aparece em destaque
logo abaixo do preço, cor vermelha) — confirma na própria página o que
`produtos-e-taxas.md` §6 já dizia sobre elegibilidade do Ton Black.

**Descrição / aparência:** maquininha portátil verde, tela touchscreen exibindo
QR Code, teclado físico numérico abaixo da tela. Tag "Internet ilimitada
Grátis" (chip próprio). `NÃO VISÍVEL NA PÁGINA`: especificação de Wi-Fi/bateria
detalhada (isso está em `produtos-e-taxas.md` §1.1, ficha técnica do modelo A8
— a página de checkout não repete ficha técnica).

**Quando usar este link:** cliente **PJ (MEI ou CNPJ)** que aceita esse
requisito em troca de taxas mais agressivas em alto volume (tabela 2.4 do
material) — é a única oferta com adesão de R$189 restrita a CNPJ. Não oferecer
para pessoa física, a oferta é exclusiva.

---

## 2. TONMEGA_TIER_SMART_POS

**Nome comercial exato exibido:**
- No carrinho: **"T3 Smart Ton Mega+"**
- No card do catálogo: **"T3 Smart"** — subtítulo: *"A maquininha Android,
  mais rápida e melhor bateria"*

**Preço mostrado:** de R$ 671,43 por **R$ 191,88 à vista**, ou **12x de R$
15,99** (71% off).

**Descrição / aparência (lista de specs da própria página):**
- Com Chip 4G e Wi-Fi
- Receba por aproximação (NFC)
- Comprovante impresso ou SMS (tem impressora)
- Aceite Pix na Maquininha
- Bateria de longa duração
- Sistema Android com Visor Touchscreen
- Garantia vitalícia
- Parcelamento em até 21x

Aparência: maquininha portátil verde, a maior tela das quatro, touchscreen,
teclado físico abaixo da tela, exibe QR Code na tela.

**Quando usar este link:** cliente **pessoa física ou negócio comum** (sem
exigência de CNPJ) que quer o modelo topo de linha — tela touch Android maior,
melhor bateria, impressão de comprovante. Bom para quem tem volume de vendas
maior e valoriza agilidade/rapidez na tela.

---

## 3. TONMEGA_TIER_S920

**Nome comercial exato exibido:**
- No carrinho: **"T3 Ton Mega+"**
- No card do catálogo: **"T3"** — subtítulo: *"A maquininha com comprovante
  impresso"*

**Preço mostrado:** de R$ 391,92 por **R$ 108,00 à vista**, ou **12x de R$
9,00** (72% off).

**Descrição / aparência (lista de specs da própria página):**
- Com Chip 3G e Wi-Fi
- Receba por aproximação (NFC)
- Comprovante impresso ou SMS (tem impressora)
- Aceite Pix na Maquininha
- Garantia vitalícia
- Parcelamento em até 21x

Aparência: maquininha portátil verde, tela menor que a T3 Smart, com teclado
físico e botões coloridos (verde/amarelo/vermelho) visíveis abaixo da tela,
exibe QR Code na tela.

**Quando usar este link:** cliente que quer opção **intermediária de preço**
(quase metade do preço da T3 Smart) mas ainda quer Wi-Fi/chip 3G próprios e
impressão física de comprovante — bom para quem precisa imprimir cupom no ato
da venda mas não precisa de tela Android touch grande.

---

## 4. TONMEGA_TIER_D195

**Nome comercial exato exibido:**
- No carrinho: **"T2 Ton Mega+"**
- No card do catálogo: **"T2"** — subtítulo: *"A maquininha compacta que tá
  sempre com você"*

**Preço mostrado:** de R$ 176,00 por **R$ 49,88 à vista**, ou **12x de R$
4,16** (72% off).

**Descrição / aparência (lista de specs da própria página):**
- Com Chip 3G e Wi-Fi
- Receba por aproximação (NFC)
- Comprovante por SMS (sem menção a impressão física nesta oferta — diferente
  da T3/T3 Smart, que dizem "impresso ou SMS")
- Aceite Pix na Maquininha
- Garantia vitalícia
- Parcelamento em até 12x (menor que o das ofertas T3, que vai até 21x)

Aparência: maquininha portátil verde, mais compacta que a T3, tela pequena,
teclado físico, exibe QR Code.

**Quando usar este link:** cliente que quer uma maquininha **compacta e mais
barata**, com Wi-Fi/chip 3G próprios (não depende do celular), mas está de
acordo em receber o comprovante só por SMS (sem impressão em papel). Bom para
ambulante/food truck/feira que quer algo pequeno e leve.

---

## 5. TONMEGA_TIER_D150 — o mais importante (nome não constava no material)

**Nome comercial exato exibido — ENCONTRADO NA PÁGINA:**
- No carrinho: **"T1 Ton Mega+"**
- No card do catálogo: **"T1"** — subtítulo: *"A maquininha compacta que
  conecta com o seu celular"*

A confirmação veio de duas fontes na própria navegação: (1) o botão "Pedir T1"
no card T1 do catálogo aponta para uma URL contendo exatamente
`productId=TONMEGA_TIER_D150`; (2) a página de checkout desse productId exibe
o item do carrinho rotulado "T1 Ton Mega+". Ou seja, **D150 = T1**, o nível de
entrada citado em `produtos-e-taxas.md` §1.0 (que só tinha o preço de adesão,
sem nome nem ficha técnica).

**Preço mostrado:** de R$ 56,57 por **R$ 16,80 à vista**, ou **12x de R$ 1,40**
(70% off) — bate exatamente com o valor de adesão do T1 já registrado em
`produtos-e-taxas.md` §1.0 (R$16,80 / 12x R$1,40).

**Descrição / aparência (lista de specs da própria página):**
- **Precisa de celular com internet** (diferente de todos os outros modelos:
  não tem a tag "Internet ilimitada Grátis" nem menção a chip/Wi-Fi próprio —
  esse é o único modelo sem conectividade própria)
- Receba por aproximação (NFC)
- Comprovante por SMS (sem impressora)
- Garantia vitalícia
- Parcelamento em até 12x

Aparência: é a menor e mais simples maquininha das quatro — verde, tela
pequena, teclado físico numérico, exibe QR Code na tela, sem os botões
coloridos vistosos das T2/T3.

`NÃO VISÍVEL NA PÁGINA`: modelo de hardware específico (a página não usa o
termo "D150" em nenhum texto visível, só nas URLs/parâmetros técnicos — o nome
comercial voltado ao cliente é sempre "T1").

**Quando usar este link:** cliente com **orçamento mais restrito** (é a oferta
mais barata da linha, R$16,80) e que **já tem celular com internet** para
parear com a maquininha — ela não tem chip/Wi-Fi próprios, então depende do
celular do lojista. Bom para quem está começando a vender agora, vende pouco
ou esporadicamente, e não quer/pode investir mais no equipamento. Não é a
melhor opção para quem precisa emitir comprovante impresso ou para quem não
tem internet estável no celular.

---

## Resumo comparativo (só o que foi visto nas páginas)

| productId | Nome exibido | Preço à vista | 12x | Chip/Wi-Fi próprio | Impressora | Parcelamento máx. |
|---|---|---|---|---|---|---|
| TONBLACK_TIER_SMART_POS | T3 Smart Ton Black | R$ 189,00 | R$ 15,75 | Sim (Internet ilimitada Grátis) | Sim (impresso ou SMS) | `NÃO VISÍVEL NA PÁGINA` |
| TONMEGA_TIER_SMART_POS | T3 Smart Ton Mega+ / T3 Smart | R$ 191,88 | R$ 15,99 | Sim (chip 4G e Wi-Fi) | Sim (impresso ou SMS) | 21x |
| TONMEGA_TIER_S920 | T3 Ton Mega+ / T3 | R$ 108,00 | R$ 9,00 | Sim (chip 3G e Wi-Fi) | Sim (impresso ou SMS) | 21x |
| TONMEGA_TIER_D195 | T2 Ton Mega+ / T2 | R$ 49,88 | R$ 4,16 | Sim (chip 3G e Wi-Fi) | Não (só SMS) | 12x |
| TONMEGA_TIER_D150 | T1 Ton Mega+ / T1 | R$ 16,80 | R$ 1,40 | **Não** — precisa do celular do cliente | Não (só SMS) | 12x |
