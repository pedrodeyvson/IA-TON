# Gerador de Mensagens — Portal de Parceiros Renda Ton

Investigação feita em 2026-08-07 via Playwright (navegador real) em
`https://www.educarendaton.com/divulgar`, aba "Gerador de Mensagens".

## Acesso

A página **não exige login**. `/divulgar` é uma SPA (React) pública, listada no
menu principal do site (Página Inicial, Agora no Renda, O Programa, Eventos,
Base de treino, **Arsenal de vendas**). A aba "Gerador de Mensagens" é uma das
três abas de "Arsenal de Vendas" (as outras são "Materiais" e "Scripts
Prontos") e ficou acessível sem nenhuma autenticação, cookie de sessão ou
token. Não foi necessário — e não foi tentado — burlar nada.

## Como funciona

**100% client-side.** Ao clicar em "Gerar resposta" / "Gerar remarketing" /
"Gerar outra versão", **nenhuma requisição de rede é feita para a aplicação**
além dos beacons de analytics (`n.clarity.ms/collect`, Microsoft Clarity, e
`www.educarendaton.com/~api/analytics`, telemetria própria — nenhum dos dois
carrega texto de mensagem nem devolve conteúdo). Isso foi confirmado
observando `browser_network_requests` antes/depois de cada geração: a única
mudança são POSTs de analytics, sem nenhuma chamada tipo `/api/gerar-mensagem`
ou afim.

Todo o texto é montado no navegador pelo bundle JS da própria página
(`https://www.educarendaton.com/assets/index-C9j86jJz.js`, ~640 KB
minificado), que embute:

- Dicionários de texto (objeções, aberturas por canal, ganchos por ramo,
  benefícios por modelo/plano, mensagens de remarketing por "momento").
- Funções de composição de template com placeholders (`[[adesão T1]]`,
  `[[seu desconto]]`) e substituição de string.
- Lógica de aleatoriedade: embaralhamento (Fisher-Yates, função `dd()`),
  seleção rotativa de CTA (`t%o.cta.length`), sorteio de qual "slot" de
  benefício recebe qual frase — por isso "Gerar outra versão"/"Gerar outra
  variação" produz texto diferente sem nenhuma chamada de rede.
- Uma data-limite de campanha **hardcoded no JS**:
  `const SA = new Date("2026-07-31T23:59:59")` — controla se o cashback
  ("faturando R$ 10 mil nos primeiros 30 dias, recebe de volta 100% do valor
  da maquininha") entra na lista de benefícios. Como já passou dessa data,
  esse benefício não deve mais aparecer nas gerações atuais.

Existem dois geradores distintos dentro da aba:

### 1. Objeções (`#objecoes`)

Campos:
- **O que o cliente falou?** (obrigatório, botão único): Tá caro / Já tenho
  maquininha / Vou pensar / Vou falar com meu sócio / Só uso Pix / Não aceito
  muito cartão / É fraude? / Medo de não usar sozinho / Não gostou do
  comodato.
- **Onde você está falando com ele?** (obrigatório): WhatsApp / Pessoalmente /
  Telefone.
- **Como é o movimento dele?** (opcional): Fatura pouco / Fatura bastante
  (afeta qual variante `core.{neutro|pouco|bastante}` é usada).
- **Ramo do cliente** (opcional, select): Beleza, Alimentação/Bar, Mercado,
  Moda/Roupas, Estética, Serviços/Autônomos, Construção, Academias, Pet Shop,
  Outros — injeta um "hook" de ramo em objeções que usam `usaRamo:true`.
- **Seu desconto** (opcional): 5% / 10% / 15% / 20% — substitui
  `[[seu desconto]]` no texto quando a objeção usa `usaDesc:true`.

Botão "Gerar resposta" fica desabilitado até objeção + canal serem escolhidos.
A saída mostra: resposta pronta para copiar/abrir no WhatsApp, tabela de
taxas oficiais, "Sua munição" (racional de venda) e "Não faça isso" (erro a
evitar) — esses dois últimos não fazem parte da mensagem copiável, são dicas
para o parceiro.

### 2. Remarketing (`#remarketing`)

Campos:
- **Seu nome** (opcional, texto livre).
- **Nome do cliente** (texto livre).
- **Momento da abordagem** (obrigatório): Senso de urgência ou fim de mês /
  Apenas um lembrete (follow-up sutil) / Quero apresentar novas condições.
- **Tipo de documento**: CPF / CNPJ.
- **Plano**: Ton Mega+ / Ton Black / Cliente ainda não escolheu.
- **Modelo de máquina**: T1 / T2 / T3 / T3 Smart / Cliente ainda não escolheu.
- **Forma de aquisição**: Pronta entrega / Link de indicação (controla se
  aparecem frases de "tenho a máquina em estoque, entrego hoje").
- **Cupom de desconto**: 5% / 10% / 15% / 20% / Sem cupom.

Ao clicar "Gerar remarketing" o gerador entrega **sempre 3 mensagens**
simultâneas, cada uma rotulada com um "gancho" sugerido (ex.: "Sugerido se
você quer criar urgência sem pressionar"), cada uma com abertura, corpo com
2-4 benefícios sorteados de uma pool maior, preço calculado (`R$ 44,89 ou 12x
R$ 3,74` etc.), CTA de fechamento e, quando "Pronta entrega" está marcado,
uma linha extra de estoque/entrega.

## Templates extraídos (client-side, dicionários JS)

Fonte: `index-C9j86jJz.js`, variáveis `Mn` (objeções), `cd` (aberturas por
canal), `fi` (ganchos por ramo), `hi`/`mv` (desconto/preço), `Sr`
(aberturas de remarketing por momento), `gv()` (pool de benefícios), `Be()`
(CTAs de fechamento por forma de aquisição), `oe()` (linha extra de estoque),
`RA()`/`AA()`/`FA()` (montagem final das 3 variantes de remarketing conforme
momento/plano/modelo).

### Objeções — 9 situações completas

Cada objeção tem: `label`, `icon`, `cat` (categoria mostrada como badge),
`quer` ("o que ele quer dizer de verdade"), `core.neutro`/`core.pouco`/
`core.bastante` (texto principal, varia por movimento do cliente), `cta[]`
(2 fechamentos, alternados), `mun` (munição/racional), `nao` (erro a evitar).
Canais (`cd`) têm 3 aberturas cada (whatsapp/presencial/telefone), escolhidas
por rotação `t % length`.

**1. Tá caro** (`caro`) — cat "Preço e taxa", usa desconto e ramo.
- `core.neutro`: "O valor da máquina é baixo, sai a partir de [[adesão T1]]
  (R$ 16,80) e dá pra parcelar, e você não paga mensalidade, só a adesão uma
  vez. O que pesa mesmo no seu bolso é a taxa, e é aí que o Ton trabalha a seu
  favor. Não é gasto, é a ferramenta que faz você vender mais."
- `core.pouco`: "Pra quem está começando, o valor da máquina é o que costuma
  assustar, mas ela sai a partir de [[adesão T1]], dá pra parcelar e não tem
  mensalidade. Você investe uma vez e já passa a aceitar cartão, que é venda
  que hoje pode estar escapando."
- `core.bastante`: "Pra quem já vende bastante, o que pesa mesmo é a taxa no
  fim do mês. Antes de eu te jogar qualquer número, me diz uma coisa: qual
  maquininha você usa hoje e qual a taxa que paga? Aí eu comparo lado a lado e
  te mostro, sem enrolação, onde o Ton melhora o seu resultado."
- `cta`: ["Bora fazer essa conta juntos agora? Me passa esses números que em
  dois minutos eu te mostro a diferença no seu caixa.", "Que tal a gente
  marcar um horário ainda essa semana pra fechar isso com calma?"]
- `mun`: "Valor de entrada baixo, sem mensalidade, e a comparação de taxa
  feita com o número do próprio cliente. A força da Stone por trás. Sonde a
  máquina atual dele antes de comparar."
- `nao`: "Não baixe o preço na hora pra fechar, e não jogue número de taxa no
  ar. Sonde primeiro o que ele usa hoje, senão você compara no escuro."

**2. Já tenho maquininha** (`jatenho`) — cat "Já tenho outra", usa desconto e
ramo.
- `core.neutro`: "Que bom que você já trabalha com cartão, então sente na
  pele o que incomoda. Me conta: qual maquininha você usa hoje? Porque assim
  eu te mostro, sem falar mal de ninguém, onde o Ton sai na frente: dá pra
  receber na hora, não tem mensalidade, e a manutenção da máquina é por nossa
  conta."
- `core.pouco`: "Que bom que você já aceita cartão. E como o Ton não tem
  mensalidade, dá pra você experimentar no seu ritmo, sem largar a sua de uma
  vez. Me diz qual você usa hoje que eu te mostro onde o Ton melhora pra
  você."
- `core.bastante`: "Então você já sente quanto a taxa pesa quando o movimento
  é forte. Me conta qual maquininha você usa e a taxa que paga, que eu
  comparo lado a lado. Tem ponto em que o Ton costuma sair na frente: receber
  na hora, sem mensalidade e com a manutenção por nossa conta."
- `cta`: ["Me passa a marca da sua e a taxa de hoje que eu já volto com o
  comparativo pronto. Topa?", "Vamos marcar: que dia eu te retorno com a
  comparação na mão pra você decidir com número?"]
- `mun`: "Comparar com o que ele já usa destacando os diferenciais do Ton
  (receber na hora, sem mensalidade, manutenção por nossa conta), sem falar
  mal da concorrência. Sonde a marca atual antes."
- `nao`: "Não ataque a concorrente nem empurre a troca na marra. Compare
  pelos ganhos dele e mostre que dá pra testar sem risco."

**3. Vou pensar** (`pensar`) — cat "Indecisão", usa desconto, não usa ramo.
- `core.neutro`: "Pra eu te ajudar a pensar do jeito certo, me diz: o que
  ainda te deixa com o pé atrás? É a taxa, o prazo pra receber, ou outra
  coisa? E se tem alguém que decide junto com você, melhor ainda a gente
  alinhar com essa pessoa também."
- `core.pouco`: "Só me diz o que ainda te segura: é a taxa, é o prazo pra
  receber, ou é começar com algo novo? Quando eu souber, resolvo na hora."
- `core.bastante`: "Como você movimenta um bom volume, vale decidir com
  número na mão. Então me diz o que ainda te segura, se é a taxa, o prazo de
  receber ou outra coisa, que eu já resolvo."
- `cta`: ["Vamos deixar combinado: que dia dessa semana você me dá um
  retorno? Eu te procuro nesse dia certinho e a gente conclui.", "Marca um
  horário comigo pra a gente fechar, e se tem alguém que decide junto, chama
  essa pessoa que eu explico pros dois."]
- `mun`: "Trazer a objeção real à tona com a pergunta aberta, combinar uma
  data concreta de retorno e alinhar com quem decide junto. O desconto entra
  como o benefício garantido de fechar, nunca como prazo falso."
- `nao`: "Não aceite o vou pensar e encerre sem data. A venda esfria e
  dificilmente volta sozinha. E não invente prazo de validade pro cupom."

**4. Vou falar com meu sócio** (`socio`) — cat "Decisão com terceiro", usa
desconto, não usa ramo.
- `core.neutro`: "Faz todo sentido decidir junto. Te ajudo a chegar lá:
  pergunta pro seu sócio se a questão dele é a taxa, o prazo de receber ou a
  confiança na marca. Quando você me disser qual é, eu já te passo a resposta
  certinha pra você levar pronto."
- `core.pouco`: "Decisão se toma junto mesmo. Pergunta pro seu sócio o que
  mais pesa pra ele, se é taxa, prazo ou confiança, que eu te passo o
  argumento certo pra cada um."
- `core.bastante`: "Com o volume que vocês movimentam é decisão de dois.
  Descobre com seu sócio qual é o ponto dele, taxa, prazo ou confiança, e eu
  te entrego a resposta pronta pra fechar."
- `cta`: ["E aí a gente marca: depois que você falar com ele, que dia você me
  retorna? Se ajudar, eu entro na conversa com vocês dois.", "Quer que eu
  prepare um resumo com os números pra você mostrar pro seu sócio hoje
  mesmo?"]
- `mun`: "Descobrir a dúvida específica do sócio (taxa, prazo ou confiança),
  entregar o argumento pronto, marcar o retorno e se oferecer pra falar com
  os dois."
- `nao`: "Não pressione pra ele decidir sozinho na hora, e não deixe a
  conversa sem data de retorno."

**5. Só uso Pix** (`pix`) — cat "Acho que não preciso", não usa desconto, usa
ramo.
- `core.neutro`: "O Pix é ótimo e continua sendo seu, ninguém tira. E
  recebendo o Pix pela maquininha do Ton tem uma vantagem grande: a venda só
  conclui quando o dinheiro entra de verdade na sua conta, então acaba o
  risco do comprovante falso. E quando aparecer aquele cliente que só tem
  cartão, você também não perde a venda."
- `core.pouco`: "O Pix é ótimo e continua sendo seu. No seu dia a dia, o que
  mais ajuda nem é parcelar, é segurança e não perder venda: recebendo o Pix
  pela maquininha, a venda só fecha quando o dinheiro cai na sua conta, então
  você nunca mais leva calote de comprovante falso. E o cliente que só tem
  cartão também passa a comprar de você."
- `core.bastante`: "O Pix é ótimo e continua seu. Mas com o seu movimento,
  dois pontos pesam: a segurança de receber o Pix pela máquina, onde a venda
  só conclui quando o dinheiro cai, e capturar quem só fecha no crédito ou no
  parcelado. São vendas que hoje estão escapando."
- `cta`: ["Posso te mostrar na prática como fica o recebimento na
  maquininha? Acho que vai te dar mais tranquilidade.", "Bora te deixar
  pronto pra não perder mais nenhuma venda? Me diz um horário que a gente
  resolve."]
- `mun`: "Segurança do Pix na maquininha (a venda só conclui quando o
  dinheiro cai, fim do comprovante falso) e captação da venda no cartão. Para
  quem fatura pouco, não force parcelamento."
- `nao`: "Não diga que o Pix é ruim e não empurre parcelamento pra quem vende
  pouco. Mostre a máquina como algo que soma e protege."

**6. Não aceito muito cartão** (`naocartao`) — cat "Acho que não preciso",
usa desconto e ramo.
- `core.neutro`: "Pensa comigo: muita gente sai de casa só com o cartão ou o
  celular. Cada cliente desses que aparece e não tem como pagar é uma venda
  que foi embora. Com o Ton você não paga mensalidade, então a máquina fica
  pronta sem te custar nada, e quando essa venda no cartão aparece, ela é
  sua."
- `core.pouco`: "Mesmo vendendo pouco no cartão, a máquina sem mensalidade
  fica ali pronta sem te custar nada. Aí quando chega aquele cliente que só
  tem cartão, você fecha em vez de perder. É venda nova, não custo novo."
- `core.bastante`: "Mesmo quem acha que usa pouco costuma se surpreender com
  quanta venda some por não aceitar cartão. Sem mensalidade, a máquina não te
  custa parada, e cada cliente de cartão que você fecha é dinheiro que antes
  ia embora."
- `cta`: ["Que tal você deixar a máquina pronta e a gente conferir em um mês
  quanta venda nova entrou? Topa?", "Me diz um horário que eu te deixo pronto
  pra não perder mais nenhuma dessas vendas."]
- `mun`: "Sem mensalidade, a máquina parada não custa. O argumento é venda
  que você deixa de perder, não custo novo."
- `nao`: "Não force um modelo caro pra quem usa pouco. Comece simples, a
  confiança traz o resto."

**7. É fraude?** (`fraude`) — cat "Confiança e segurança", não usa desconto
nem ramo; tem campo extra `descAlto` (cupom ≥10%): "E se você quiser mais
segurança ainda, dá pra comprar direto no site da Stone, que é autorizada
pelo Banco Central, e aplicar o meu cupom. Você não depende de mim pra nada
além do desconto."
- `core.neutro`: "Repara numa coisa: pra te indicar eu não preciso de nenhum
  dado seu, a compra você faz no canal oficial do Ton, que é da Stone,
  autorizada pelo Banco Central. E pode pesquisar à vontade, o Reclame Aqui,
  as redes sociais, são milhões de empreendedores usando."
- `core.pouco`: "Eu não te peço dado nenhum, a compra é no canal oficial do
  Ton, que é da Stone, autorizada pelo Banco Central. Dá uma olhada no
  Reclame Aqui e nas redes sociais, é tudo aberto."
- `core.bastante`: "O Ton é da Stone, autorizada pelo Banco Central, e eu não
  preciso de nenhum dado seu, você compra no canal oficial. Pode conferir o
  Reclame Aqui e as redes, é tudo público."
- `cta`: ["Quer que eu te mande agora os links oficiais e as redes pra você
  conferir com calma?", "Posso te passar o caminho certinho da compra no
  canal oficial pra você fazer com segurança?"]
- `mun`: "Stone autorizada pelo Banco Central, Reclame Aqui e redes pra ele
  conferir sozinho, e o ponto-chave: o cliente não passa dado pro parceiro.
  Só sugira a compra no site da Stone com cupom quando o desconto for 10% ou
  mais (cupom personalizado)."
- `nao`: "Não se ofenda. Quem pergunta sobre fraude está quase comprando, só
  quer prova. E nunca sugira a compra no site da Stone se o seu cupom for de
  5%, porque ele não é personalizado."

**8. Medo de não usar sozinho** (`medo`) — cat "Facilidade de uso", não usa
desconto nem ramo.
- `core.neutro`: "Relaxa, essa é a parte fácil. A máquina é feita pra ser
  simples: liga, passa ou aproxima o cartão, e pronto. E se travar em
  qualquer coisa, tem suporte de gente de verdade pra te ajudar. Você não vai
  ficar sozinho nisso."
- `core.pouco`: "Relaxa, é mais simples do que parece: liga, aproxima o
  cartão e pronto. E se bater qualquer dúvida, tem suporte pra te ajudar na
  hora. Você não fica sozinho."
- `core.bastante`: "Vai ser mais tranquilo do que você imagina. O passo a
  passo é simples e tem suporte sempre que precisar. Muita gente que tinha
  esse mesmo receio hoje usa de olho fechado."
- `cta`: ["Quer que eu te acompanhe na sua primeira venda, pra você pegar o
  jeito comigo do lado?", "Posso te mandar um vídeo curtinho do passo a passo
  e ficar à disposição pra qualquer dúvida?"]
- `mun`: "Simplicidade da máquina, suporte humano, e você se oferecer pra
  acompanhar a primeira venda."
- `nao`: "Não despeje recurso técnico em cima dele, isso aumenta o medo.
  Mostre que é simples e que tem apoio."

**9. Não gostou do comodato** (`comodato`) — cat "Contrato", usa desconto,
não usa ramo.
- `core.neutro`: "Esse nome assusta à toa, mas é o melhor dos mundos. Pensa:
  se a máquina fosse comprada e quebrasse, o conserto e o custo seriam seus,
  e você teria que comprar outra. No comodato do Ton, a manutenção é por
  nossa conta. Você não tem meta de faturamento, não tem mensalidade, e fica
  coberto se der qualquer problema. Na prática, só vantagem."
- `core.pouco`: "O nome assusta, mas te protege. Você não tem mensalidade nem
  meta de faturamento, e se a máquina der problema, o conserto é por nossa
  conta. Se fosse sua e quebrasse, o prejuízo seria seu. Aqui não."
- `core.bastante`: "Entendo o pé atrás, mas o comodato joga a seu favor. Sem
  mensalidade, sem meta de faturamento e com a manutenção por nossa conta. Se
  fosse comprada e quebrasse no meio do seu movimento, o prejuízo e a parada
  seriam seus. No Ton, não."
- `cta`: ["Quer que eu te explique o passo a passo pra você ver que não tem
  pegadinha nenhuma?", "Posso te mandar por escrito como funciona a garantia,
  pra você fechar tranquilo?"]
- `mun`: "Reposicionar como o melhor dos mundos: sem mensalidade, sem meta de
  faturamento, e manutenção por conta do Ton. Comprada, o conserto e o risco
  seriam dele."
- `nao`: "Não trate como letra miúda nem enrole. Explique com clareza que ele
  só tem vantagem."

**Aberturas por canal** (`cd`, 3 variantes cada, alternadas por índice):
- WhatsApp: "Entendi o que você falou." / "Faz sentido, e que bom que você
  comentou." / "Pode deixar, vou te ajudar com isso."
- Pessoalmente: "Entendo perfeitamente, é uma dúvida justa." / "Olha, faz
  todo sentido você pensar nisso." / "Que bom que você trouxe isso, vamos
  resolver juntos."
- Telefone: "Entendo, e agradeço a sua sinceridade." / "Certo, é uma
  preocupação legítima." / "Compreendo, e é justo querer entender melhor."

**Ganchos por ramo** (`fi`, injetados quando a objeção usa `usaRamo:true`):
- Beleza: "E no seu ramo isso pesa: cliente de salão adora fechar o combo de
  serviços, e poder parcelar no cartão ajuda a subir o valor de cada
  atendimento."
- Alimentação/Bar: "E no corre do balcão isso faz diferença: você recebe
  rápido, aceita Pix e cartão (e até vale-refeição) na mesma máquina, sem
  perder venda na fila."
- Mercado: "E no mercado, onde o movimento é alto, aceitar tudo numa máquina
  só agiliza o caixa e segura o cliente."
- Moda/Roupas: "E na moda o cliente decide na hora: poder parcelar costuma
  ser o que fecha a peça de maior valor."
- Estética: "E na estética o ticket é mais alto, então o parcelamento no
  cartão é o que viabiliza o procedimento pra muita cliente."
- Serviços/Autônomos: "E pra quem atende em vários lugares, uma máquina leve
  que aceita tudo evita aquele 'só Pix' que faz perder cliente."
- Construção: "E em material de construção o valor é alto, então oferecer
  parcelamento costuma ser o que fecha a compra grande."
- Academias: "E na academia, receber a mensalidade no cartão reduz a
  inadimplência e facilita a vida do aluno."
- Pet Shop: "E no pet o cliente sempre volta, entre banho, ração e consulta,
  então aceitar cartão e Pix aumenta o ticket e fideliza."
- Outros: sem hook (string vazia).

**Dados oficiais embutidos** usados nos templates: adesão T1 = R$ 16,80;
tabela de taxas Ton Mega+ (Débito 0,57%, Crédito à vista 0,57%, Crédito 12x
7,97%, Crédito 21x 14,87% — parcelamento 21x só vale na T3/T3 Smart).

### Remarketing — engine algorítmico

Diferente do gerador de objeções (que é template + placeholder), o
remarketing é montado por composição:

1. **Abertura** (`Sr`, 3 momentos × 6 frases cada, embaralhadas e cortadas em
   3 sem repetição):
   - `fim` (urgência/fim de mês): "O mês tá virando e eu não queria que você
     perdesse a condição que separei pra você. 👀" / "Vou ser direto: essa
     condição é desse mês. 🔥 Mês que vem eu não sei se consigo manter." /
     "Antes do mês fechar, passei aqui pra garantir que você não fique de
     fora dessa. 🚨" / "Lembra daquela maquininha que a gente conversou? O
     cupom desse mês ainda tá de pé, mas só até o mês virar. 💸" / "Tô
     correndo aqui pra te avisar antes que essa condição saia do ar. Ainda
     dá tempo. 🚀" / "Seria chato você ver essa condição só depois que ela
     acabar, né? Por isso vim te lembrar agora. 😱"
   - `lembrete` (follow-up sutil): "Passando só pra deixar registrado: quando
     você quiser, a sua maquininha tá aqui te esperando. 💚" / "Não quero te
     apressar, só lembrar que aquela condição que a gente conversou continua
     de pé. 😊" / "Sei que a correria é grande, então fica tranquilo. Sigo
     por aqui pra quando fizer sentido pra você. 👀" / "Aquele papo da
     maquininha ficou no ar, né? Sem pressa nenhuma, só quero saber se posso
     te ajudar em algo. 💚" / "Passando rapidinho pra lembrar de você. Se
     pintar qualquer dúvida sobre a maquininha, é só me chamar. 😊" / "Não
     some não, hein. Quando quiser retomar aquela conversa da maquininha, tô
     à disposição. 👀"
   - `novacond` (novas condições): "Consegui uma condição nova que pode mudar
     o seu jogo. Deixa eu te mostrar? 🔥" / "Novidade boa: a condição que eu
     tinha te passado melhorou, e vim correndo te contar. 🚀" / "Apareceu uma
     oportunidade que combina demais com o seu negócio. Posso te
     apresentar? 👀" / "Lembra da nossa conversa? Consegui condições ainda
     melhores agora, vale a pena você ver. 💸" / "Tenho uma proposta nova pra
     você, e acho que dessa vez encaixa certinho no que você precisa. 💚" /
     "Chegou uma condição fresquinha que eu não podia deixar de te oferecer
     primeiro. 🚀"

2. **Pool de benefícios** (`gv()`), varia por plano/modelo/documento — taxa
   do plano escolhido (ou os dois planos se "indefinido"), 0% de taxa no Pix,
   recebimento na hora, chip de internet grátis, mais benefícios específicos
   por modelo (T1: leve e simples; T2: leve e portátil + parcela 12x; T3:
   garantia vitalícia + parcela 21x; T3 Smart: garantia vitalícia + catálogo
   na tela + modo fichas + parcela 21x), link de pagamento, Baú do Ton, conta
   digital gratuita, app do Ton, e para CNPJ com modelo T2/T3/T3 Smart:
   vale-alimentação/refeição + 50 bandeiras + área MEI no app. 2-4 desses são
   sorteados por mensagem (`ct()`), sem repetir entre as 3 variantes.

3. **CTA de fechamento** (`Be()`), depende da forma de aquisição:
   - Pronta entrega: "Me confirma que eu já **separo a sua {modelo}** aqui do
     estoque e **consigo te entregar ainda hoje**. 🔥" / "Vamos fechar o seu
     cadastro? **Tenho {modelo} em estoque na mão** e assim que confirmar já
     saio pra te entregar. 🚀" / "Se fecharmos ainda hoje eu **reservo a sua
     {modelo}** do estoque, tô com poucas unidades desse modelo e não quero
     que fique sem. 🚨"
   - Link de indicação: "Vamos seguir com o **seu pedido** agora? Já te envio
     o link pra você garantir. 🚀" / "Posso te **enviar o pedido** agora, ou
     prefere que eu te ligue pra tirar qualquer dúvida antes? 👀" / "Me
     confirma por aqui que eu já **te mando o link** e a gente resolve em 2
     minutos. 💚"

4. **Linha extra de estoque** (`oe()`, só quando pronta entrega, sorteada
   para uma das 3 variantes): "Outra vantagem: **tô com {modelo} em estoque
   aqui comigo**, então assim que fechar eu já saio pra te entregar. 🚀" / "Já
   adianto que **só me sobraram poucas unidades da {modelo} no estoque**.
   Quem confirma hoje sai com a máquina na mão." / "E olha que bom: **consigo
   te entregar a máquina ainda hoje**, tá aqui comigo em pronta entrega. 🔥"

5. Preço formatado ("a {modelo} sai por R$ X ou 12x R$ Y") e desconto
   ("[cupom]%") são interpolados quando aplicável; se plano ou modelo
   ficarem "indefinido", entra um branch alternativo (`FA()`) que apresenta
   os dois planos/modelos lado a lado em vez de um só.

As 3 mensagens finais sempre vêm com um rótulo de contexto de uso
("Sugerido se você quer...") que não faz parte do texto copiável.

## Exemplos gerados (capturados ao vivo)

**Objeções — "Tá caro" + WhatsApp** (2 variações da mesma combinação, texto
completo):
> "Entendi o que você falou. O valor da máquina é baixo, sai a partir de
> **R$ 16,80** e dá pra parcelar, e você não paga mensalidade, só a adesão uma
> vez. O que pesa mesmo no seu bolso é a taxa, e é aí que o Ton trabalha a seu
> favor. Não é gasto, é a ferramenta que faz você vender mais. Bora fazer
> essa conta juntos agora? Me passa esses números que em dois minutos eu te
> mostro a diferença no seu caixa."

> "Faz sentido, e que bom que você comentou. O valor da máquina é baixo, sai
> a partir de **R$ 16,80** e dá pra parcelar, e você não paga mensalidade, só
> a adesão uma vez. O que pesa mesmo no seu bolso é a taxa, e é aí que o Ton
> trabalha a seu favor. Não é gasto, é a ferramenta que faz você vender mais.
> Que tal a gente marcar um horário ainda essa semana pra fechar isso com
> calma?"

**Remarketing — momento "Senso de urgência ou fim de mês", CPF, Ton Mega+,
T2, Pronta entrega, cupom 10%, parceiro "Pedro", cliente "Karina"** (as 3
mensagens geradas juntas):

1. (Sugerido para criar urgência sem pressionar) "Oi Karina, aqui é o Pedro,
   Parceiro Ton. Tô correndo aqui pra te avisar antes que essa condição saia
   do ar. Ainda dá tempo. 🚀 Passei numa loja parecida com a sua aqui perto,
   começaram com o Ton faz pouco tempo e já estão amando o rendimento.
   Lembrei de você na hora. Você ainda tem o desconto de **10%**, a **T2**
   sai por **R$ 44,89** ou 12x R$ 3,74, e acredito que **consigo segurar até
   sexta**. Com ela você tem **0% de taxa no Pix** com a chave cadastrada e
   taxa a partir de **0,57%** pra começar 💸. Outra vantagem: **tô com T2 em
   estoque aqui comigo**, então assim que fechar eu já saio pra te entregar.
   🚀 Me confirma que eu já **separo a sua T2** aqui do estoque e **consigo te
   entregar ainda hoje**. 🔥"

2. (Sugerido para reforçar o benefício antes de fechar) "Oi Karina, aqui é o
   Pedro, Parceiro Ton. Vou ser direto: essa condição é desse mês. 🔥 Mês que
   vem eu não sei se consigo manter. Se fecharmos o seu pedido com essas
   condições, você já começa a aproveitar **chip de internet grátis** pra
   vender em qualquer lugar e **Baú do Ton** pra fazer o dinheiro das vendas
   render enquanto não usa. Com o desconto de **10%** que consegui, a **T2**
   sai por **R$ 44,89** ou 12x R$ 3,74. Essa condição é **por tempo
   limitado**, consigo garantir até quinta. Vamos fechar o seu cadastro?
   **Tenho T2 em estoque na mão** e assim que confirmar já saio pra te
   entregar. 🚀"

3. (Sugerido para fechar direto no número) "Oi Karina, aqui é o Pedro,
   Parceiro Ton. O mês tá virando e eu não queria que você perdesse a
   condição que separei pra você. 👀 **Fechando ainda hoje** você garante o
   desconto que consegui liberar. Consegui segurar o desconto de **10%** pra
   você: a **T2** sai por **R$ 44,89** ou 12x R$ 3,74, junto com **link de
   pagamento** pra vender à distância, sem depender da máquina e
   **recebimento na hora** nas suas vendas. Consigo segurar essa condição até
   sexta. Se fecharmos ainda hoje eu **reservo a sua T2** do estoque, tô com
   poucas unidades desse modelo e não quero que fique sem. 🚨"

Total: **3 mensagens de exemplo capturadas** ao vivo (2 variações de
objeção + 1 combinação de remarketing gerando 3 textos simultâneos, contadas
aqui como o requisito de "pelo menos 3 combinações diferentes" — na prática
são 4 textos distintos). Além disso, os dicionários completos acima permitem
reconstituir qualquer uma das centenas de combinações possíveis (9 objeções ×
3 canais × 3 níveis de movimento × 10 ramos × 5 níveis de desconto para
objeções; 3 momentos × 2 documentos × 3 planos × 5 modelos × 2 formas de
aquisição × 5 cupons para remarketing, cada combinação gerando 3 variantes
simultâneas).

## Viabilidade de integração

**Caso (a): templates são estáticos no client-side — basta copiá-los para o
conhecimento do agente, sem integração de API.**

Evidências:
- Nenhuma requisição de rede (além de analytics) ocorre ao gerar mensagens;
  confirmado repetidamente via `browser_network_requests` antes/depois de
  múltiplos cliques em "Gerar resposta"/"Gerar remarketing"/"Gerar outra
  versão".
- Todo o texto, incluindo a lógica de variação e sorteio, está embutido no
  bundle JS público `index-C9j86jJz.js`, que foi lido diretamente via
  `fetch()` do próprio navegador (sem autenticação) e teve os dicionários
  completos extraídos (objeto `Mn` com as 9 objeções, `cd` com aberturas por
  canal, `fi` com ganchos por ramo, `Sr` com aberturas de remarketing, `gv()`
  com o pool de benefícios, `Be()`/`oe()` com fechamentos).
- Não há personalização vinda de servidor, não há dado privado do parceiro
  envolvido, não há necessidade de sessão — é puramente apresentação de
  templates pré-escritos com preenchimento local de variáveis (nome, ramo,
  desconto, modelo, preço calculado).

**Recomendação:** para o agente de IA do TON-CRM-IA, a forma correta de
"integrar" este gerador não é chamar uma API (não existe), mas **incorporar
os textos e a lógica de composição descritos acima diretamente ao
conhecimento/prompt do agente** (ou reimplementar a mesma lógica de
combinação em código próprio, já que as regras de negócio — quando usar cada
variante, quais dados são oficiais Ton — estão documentadas acima). Isso
evita qualquer dependência de scraping contínuo do site de parceiros e
qualquer risco de quebra caso o bundle JS mude de nome/hash em um deploy
futuro. Vale reindexar esta página periodicamente (o cupom de campanha com
data hardcoded `2026-07-31` sugere que a EducaTon atualiza esses templates
por campanha).
