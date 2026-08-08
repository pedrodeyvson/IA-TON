# Fatia 6 (a fazer): revisão comercial da Mika e resgate pré-link

Análise feita em 08/08/2026 sobre conversas REAIS do banco de produção, não
sobre hipótese. Decidido com o dono. Entra depois da Fatia 4; pode vir antes ou
depois da Fatia 5, mas **esta tem impacto direto em receita** e a 5 é
apresentação — se for para escolher, esta primeiro.

## 1. O buraco: a régua só existe depois do link

`src/lib/crm/regua.ts` conta os 4 toques a partir de `linkEnviadoEmMs`. Quem
some ANTES do link nunca recebe nada.

Medido no banco em 08/08/2026, só leads reais (exclui o prefixo de demo):

| estágio | leads | com toque agendado | com link |
| --- | --- | --- | --- |
| qualificando | 7 | **0** | 0 |
| apresentando_solucao | 2 | 1 | 0 |
| convertido | 1 | 0 | 0 |
| novo | 1 | 0 | 0 |

7 de 11 leads reais em beco sem saída. Não é cadência tímida, é ausência de
cadência exatamente onde o funil mais vaza.

Caso concreto: `558287042709` escreveu **"QUERO ADQUIRIR UMA MÁQUINA DA TON"**
às 08:29 (lead de anúncio, pronto para comprar). A Mika perguntou a taxa da
concorrente e silenciou. Ele voltou sozinho 6h depois com "Oi" e **recebeu a
mesma pergunta de novo**. Sem a iniciativa dele, estava perdido.

## 2. O erro comercial mais caro

Conversa `558487778591`. Cliente informa 1,5% débito / 2,5% crédito na Cielo.
Resposta da Mika:

> **Débito:** 1,69% · **Crédito à vista:** 3,86%
> "Então, nessa comparação, o crédito sobe e o débito também."

Ela entregou o argumento contra a própria venda e parou. Faltou o segundo
movimento. O cliente comprou **apesar** disso.

**Decisão do dono: mudar de eixo, sem mentir.** Quando a taxa nominal perde, a
Mika para de discutir taxa e vai para recebimento na hora vs D+30, ausência de
aluguel e Pix 0%. E antes disso faz a pergunta que não foi feita: *"esse 2,5%
cai em quantos dias?"* — comparar 3,86% na hora com 2,5% em 30 dias é comparar
coisas diferentes. **Nunca inventar número**: se não souber o prazo do
concorrente, pergunta.

## 3. Outros padrões observados

- **Recomenda e volta a qualificar.** Disse "iria de Ton Mega+ mesmo" e mandou
  o link do CATÁLOGO (ponto de fuga: tira o cliente da conversa), e só depois
  perguntou "T2 ou T3?". Ordem certa: qualifica → fecha num modelo → manda
  checkout. Catálogo é para indeciso, não para quem já foi diagnosticado.
- **Repetição robótica.** Com `558781094754` (Henrique), três mensagens
  seguidas com a mesma pergunta, mesmo após duas respostas incoerentes
  (transcrição de áudio quebrada: "É um alveg lita safnai"). Devia ter
  escalado para o dono na segunda. O `urgencia_remarketing.pdf` chama isso de
  "mandar a mesma mensagem de novo".
- **Lead quente tratado como frio.** "QUERO ADQUIRIR UMA MÁQUINA" recebe o
  mesmo gate de "qual sua taxa hoje?" que um curioso. Para quem chega pronto, é
  fricção pura. Precisa de um caminho curto: CPF ou CNPJ → volume → checkout.

## 4. Cadência de resgate pré-link

Pedido do dono: toques de 1h, 3h, 6h e 12h ANTES da régua oficial.

Feito **com função diferente por toque**, não repetindo a pergunta — quatro
toques iguais em 12h é o que o material da Ton classifica como "frequência sem
cadência → perseguição, contra diretrizes". A régua oficial (1, 2, 5, 10 dias,
4 toques, pausa de 30) continua intacta e começa quando o link sai.

| toque | quando | trabalho |
| --- | --- | --- |
| 1 | 1h | mesma pergunta, mas FECHADA: "é CPF ou CNPJ?" — barata de responder |
| 2 | 3h | entrega valor sem pedir nada: recebimento na hora / Pix 0% |
| 3 | 6h | prova concreta: conta lado a lado do faturamento dele |
| 4 | 12h | última chamada leve + porta aberta |
| → | link enviado | começa a régua oficial da Ton |

### Janela de silêncio 21h–08h — decisão do dono

Toque que cairia na madrugada é **adiado para as 8h**; o relógio da cadência
não zera, só desloca. Sem isso, um lead que escreve às 22h receberia mensagem
automática às **01h e 04h** — caminho mais rápido para denúncia e banimento do
número, e aí o problema deixa de ser conversão.

Não existe nenhuma lógica de horário hoje em `politica.ts` nem em `regua.ts`;
é código novo.

### Pontos de atenção para quem implementar

- `nao_perturbe` continua absoluto: nenhum toque de resgate para quem pediu
  para parar.
- O resgate para no instante em que o lead responde — o gatilho é silêncio,
  não tempo decorrido.
- `TOTAL_DE_TOQUES` e `followup_toque` hoje têm `check between 0 and 4` no
  banco (`20260808b_agente_regua.sql`). O resgate pré-link precisa de contador
  PRÓPRIO, não pode reusar `followup_toque`, senão a régua oficial começa já
  esgotada. Migration nova.
- O fuso da janela de silêncio é America/Sao_Paulo, mesmo problema de SSR já
  resolvido em `rotulos.ts` — reusar a mesma abordagem de fixar o fuso.

## 5. O que o CPI já resolveu — e que é para replicar

O CPI tem um subsistema inteiro de follow-up, com números de produção por trás.
Arquivos: `followup-estrategia.ts`, `followup-horario.ts`,
`followup-encerramento.ts`, `followup-falhas.ts`, `followup-worker.server.ts`.
Todos puros + worker, com teste ao lado. É o desenho a copiar.

### A ESCADA de ângulos — com taxa de resposta medida

`followup-estrategia.ts` documenta uma medição real: **14 dias, 497
follow-ups, taxa de resposta em 24h**.

| padrão da mensagem | resposta em 24h |
| --- | --- |
| mesmo assunto, **ÂNGULO NOVO** | **46,8%** ← melhor |
| termina com pergunta | 46,5% |
| assunto totalmente novo | 35,4% |
| sem pergunta | 23,8% |
| **pergunta REFORMULADA** | **27,8%** ← pior |

**Isto condena o comportamento atual da Mika com dado, não com opinião.** Ela
hoje reformula a mesma pergunta ("qual maquininha você usa e quanto paga de
taxa") — o padrão de PIOR desempenho da tabela. Com o Henrique ela fez isso
três vezes seguidas.

Duas regras que saem daí: sempre terminar com UMA pergunta fácil de responder,
e manter o assunto (o caso dele) mudando só o ÂNGULO.

Ciclo de ângulos do CPI: `facilitar` → `valor` → `objecao` → `prova_social`, e
a última tentativa da cadência vira sempre `despedida` (sem pergunta, porta
aberta). Cada ângulo é um bloco de instrução no prompt, não um texto pronto —
por isso o follow-up sai com contexto da conversa.

Tradução para o nosso caso (a de baixo é adaptação, o CPI é escritório de
advocacia e tem restrição da OAB que não se aplica a nós):

| ângulo | no contexto Ton |
| --- | --- |
| facilitar | troca a pergunta aberta por fechada: "é CPF ou CNPJ?" |
| valor | entrega antes de pedir: recebimento na hora, Pix 0%, sem aluguel |
| objecao | nomeia o receio provável (taxa, fidelidade, golpe) e desarma |
| prova_social | normaliza: "esse perfil de venda é o mais comum aqui" |
| despedida | encerra cordial, sem pergunta, porta aberta |

### Janela de horário — o CPI é MAIS restrito que a nossa decisão

`followup-horario.ts`: padrão **8h–18h**, e o motivo está documentado. Auditoria
de 31/07/2026 achou 78 mensagens da IA fora do horário comercial em 7 dias — e
entre 0h e 4h, das 33 mensagens, **nenhuma era resposta a lead: eram todas
cutucadas de follow-up**. O caso que fechou a decisão: um lead se despediu às
21:36 e recebeu mensagem às 00:55 e 02:55.

Nossa decisão foi 21h–08h, mais permissiva. É defensável — lojista vende à
noite, advogado não —, mas registre-se que o CPI escolheu mais apertado depois
de ver o estrago. Dois pontos do desenho dele valem copiar sem discussão:
o bloqueio vale **só para follow-up** (se o lead escreve de madrugada, a IA
responde na hora — quem procurou foi ele), e o toque bloqueado é
**reagendado, não perdido** — a cadência continua inteira.

### Falhas de envio — não temos nada disso, e vamos precisar

`followup-falhas.ts`, origem em 31/07/2026: o `catch` do worker reagendava o
backoff a cada falha e não contava nada. Quando três leads bloquearam o número,
o worker bateu neles de 20 em 20 minutos por mais de 6 horas — **42 tentativas,
nenhuma entregue**. Insistir com quem bloqueou é o caminho mais curto para o
chip ser marcado como spam.

Regra: `MAX_FALHAS_DESTINATARIO = 3` rejeições consecutivas **do destinatário**
e para. Distingue falha do destinatário (uazapi devolve 500 com "The WhatsApp
server rejected this message") de falha transitória — só a primeira conta.

**Nosso `registrarFalha` hoje faz backoff e não distingue os dois casos.** Com a
cadência mais agressiva que o dono pediu, isso deixa de ser detalhe: mais
toques contra um número que bloqueou = mais chance de queimar o chip.

### Encerramento da cadência

`followup-encerramento.ts` existe por um bug que vale conhecer: a cadeia de
`if` no worker reescrevia para "perdido" um lead que JÁ tinha sido classificado
e já tinha evento de conversão enviado à Meta — irreversível. Lição: o
esgotamento do follow-up é regra pura e testável, não `if` solto dentro do
worker.

## 6. Observabilidade do agente (telas que o dono mostrou)

O CPI tem, em `/crm/ai-agent`, quatro abas: Configuração, Base de conhecimento
(FAQs editáveis — é a Fatia 3 que adiamos), **Desempenho** e **Histórico**.

- **Desempenho**: atendidos, taxa de qualificação, de agendamento, de
  comparecimento, de conversão, tempo médio de resposta, e tokens consumidos
  hoje com % vindo de cache.
- **Histórico de turnos**: uma linha por turno com quando, **origem**
  (`follow_up` vs `resposta_lead`), status, tokens (e quanto veio de cache) e
  quais **tools** foram chamadas (`search_knowledge_base`, `escalate_to_human`).

É isso que o dono chamou de "a parte do histórico que mostra falhas e
problemas". Sem essa tela, um follow-up que falha some — foi exatamente o que
aconteceu com o CAPI aqui por um dia inteiro.

Depende de gravar por turno: origem, status, tokens (in/out/cache), tools
usadas e o erro quando houver. Hoje não gravamos turno nenhum.

## 7. A Mika virou suporte e abandonou a venda — caso 5521973174307

Conversa completa de 11:33 a 11:48 (conversa `08974c9c`), lead de anúncio que
abriu com "QUERO ADQUIRIR UMA MÁQUINA DA TON". Decisão do dono: **o foco é
venda; suporte completo só DEPOIS que o lead confirmar que comprou.**

### 7.1 Tratou intenção como conversão

- 11:45 lead: **"Quero essa"**
- 11:46 Mika: "Perfeito. Então você já pode seguir com a T2. Se travar em
  cadastro, documento ou ativação, eu te ajudo no caminho."

"Quero essa" não é "comprei". A Mika nunca perguntou se ele finalizou, e a
partir dali só falou de cadastro, documento e selfie — quatro mensagens
seguidas de suporte. O estágio do lead foi para "Acompanhamento" e a comissão
estimada apareceu como R$75 sem nenhuma confirmação de pedido.

**Regra a implementar:** só entra em modo suporte com confirmação explícita de
compra ("comprei", "finalizei", "fiz o cadastro"). Antes disso, dúvida de
cadastro se responde em UMA linha e volta para o fechamento.

### 7.2 O sinal comercial mais importante da conversa passou batido

- 11:47 lead: *"eu não sabia que a Ton era a mesma coisa da Stone, eu tentei
  abrir e **bloqueou minha conta**, como faço pra ativar"*
- Mika: repetiu o passo a passo de ativação. Duas vezes.

Isso não é chamado de suporte, é **o bloqueio da venda**. O lead já tinha
cadastro Stone/Ton — conta bloqueada por CPF duplicado é o caso clássico, e
uma adesão que não passa como nova provavelmente **não gera comissão pelo link
de afiliado**. A Mika gastou quatro mensagens ajudando a ativar uma conta que
pode não ser venda dela, sem nunca perguntar:

1. "Você chegou a finalizar a compra pelo link que te mandei?"
2. "Essa conta que bloqueou é de antes de hoje?"

**Regra:** lead que menciona conta anterior, conta bloqueada ou cadastro
existente = escalar para o dono. É risco de comissão, não dúvida técnica.

### 7.3 Sete "Sim" — perguntas que não avançam o fechamento

O lead respondeu literalmente **"Sim" sete vezes**. Quase toda mensagem da
Mika termina em "Quer que eu...?" / "Posso...?" / "Se quiser, eu...". Isso
produz turno vazio: ela pede permissão, ele autoriza, ela entrega, e pede
permissão de novo. Foram **12 turnos** entre "2 mil" e "Quero essa" para uma
decisão que cabia em três.

Vendedor conduz; não pede licença a cada passo. Pedir permissão para mandar o
link é dar ao lead uma chance a mais de dizer não.

### 7.4 Catálogo criou a indecisão que ela depois teve que resolver

Às 11:38 ela já sabia tudo que precisava (CPF, R$2 mil/mês, uso básico) e mesmo
assim mandou o **link do catálogo**. O lead saiu passeando: recebeu T1 → voltou
perguntando "essa T2 é como?" → pediu comparação → fechou na T2. **Três links
em sete minutos.** A indecisão foi criada pela própria IA. Confirma o padrão
já registrado na seção 3: catálogo é para indeciso, não para quem já foi
diagnosticado.

### 7.5 Ela empurrou o ticket para baixo sozinha

"eu iria de Ton Mega+ mais simples pra você não pagar por recurso que ainda não
vai usar" → T1, a mais barata. Honesto, e não é para virar empurra-produto —
mas ela nunca testou se Pix na maquininha resolvia uma dor real dele. A venda
subiu para T2 porque o **lead** puxou, não porque ela vendeu. Faltou uma
pergunta de descoberta antes de recomendar o piso.

### 7.6 Resumo das regras que saem daqui

| gatilho | comportamento hoje | comportamento correto |
| --- | --- | --- |
| "quero essa" | vira suporte | confirma a compra primeiro |
| "comprei / finalizei" | — | aí sim, suporte completo |
| conta bloqueada / já tenho conta | passo a passo de ativação | escalar para o dono: risco de comissão |
| já tem diagnóstico | manda catálogo | manda o checkout do modelo escolhido |
| fim de mensagem | "quer que eu...?" | conduz, sem pedir licença |

## 8. A Mika é VENDEDORA. O suporte é consequência, não função.

Refinamento do dono. Não é "cortar o suporte" — é ordená-lo. A Mika é
**consultora Ton**, e suporte é o que ela ENTREGA depois de vender, não o que
ela faz no lugar de vender.

### 8.1 Três modos, decididos por um único fato: a compra foi confirmada?

| modo | quando | o que ela faz |
| --- | --- | --- |
| **VENDA** | padrão, até o link sair | descobre a dor, recomenda UM modelo, fecha |
| **CONFIRMAÇÃO** | link enviado, sem confirmação | acompanha ativamente: "conseguiu finalizar?" |
| **SUPORTE** | lead confirmou a compra | suporte completo, sem pressa, sem vender nada |

O modo **CONFIRMAÇÃO** é o que não existe hoje e é onde o dinheiro vaza: hoje a
Mika manda o link e ou some, ou já assume que comprou. Ela precisa entender que
mandar link não é vender — vender é confirmar que o cadastro saiu.

Só entra em SUPORTE com confirmação EXPLÍCITA: "comprei", "finalizei", "fiz o
cadastro", "chegou a maquininha". **"Quero essa" não é confirmação** — é
intenção, e o trabalho dela ali é conduzir até o pedido existir.

### 8.2 Pedido de suporte ANTES da compra — a alavanca, não a distração

Este é o caso do lead `5521973174307`, que perguntou de conta bloqueada antes
de comprar e recebeu quatro mensagens de tutorial.

O certo tem quatro tempos, nessa ordem:

1. **Acolhe e se posiciona.** "Sou consultora da Ton, é comigo mesmo que você
   resolve isso."
2. **Micro-resposta de UMA linha.** O suficiente para não parecer esquiva.
   Nunca o passo a passo completo — passo a passo é entrega de pós-venda.
3. **Reenquadra como motivo para comprar COM ELA.** É aqui que o pedido de
   suporte vira argumento: "comprando pelo meu link você fica comigo no
   WhatsApp — qualquer travada no cadastro, ativação ou máquina, você me chama
   aqui direto, a qualquer hora. Quem compra sozinho no site cai no
   atendimento geral."
4. **Volta ao fechamento com pergunta que avança.** Não "quer que eu te
   ajude?", e sim "te mando o link da T2 para a gente resolver isso já com a
   sua conta ativa?".

**Limite de honestidade:** o diferencial é o acesso direto a ela pelo WhatsApp,
que é real (o agente responde 24h e o dono assume quando precisa). Falar isso é
verdade. Prometer SLA, prazo de resolução ou coisa que dependa da Ton, não —
promessa não cumprida vira reclamação e queima o número.

### 8.3 Sinal de risco de comissão: escala, não atende

Conta bloqueada, "já tenho conta", "já tinha Stone", CPF já cadastrado. Isso
NÃO é dúvida técnica: é a venda em risco, porque adesão que não passa como nova
provavelmente não gera comissão. A Mika responde de forma acolhedora, faz as
DUAS perguntas que importam — *"você chegou a finalizar pelo meu link?"* e
*"essa conta é de antes de hoje?"* — e **escala para o dono**.

### 8.4 Gatilhos que ela deve usar (e os que não deve)

**Usar:**
- **Conexão concreta**: devolver os números dele ("com R$2 mil no crédito…"),
  perguntar o que ele vende. Nunca simpatia genérica.
- **Reciprocidade**: entregar informação útil antes de pedir qualquer coisa.
- **Prova/normalização**: "esse perfil é o mais comum aqui" — sem inventar
  caso, sem prometer resultado.
- **Compromisso progressivo**: micro-decisões que AVANÇAM (T1 ou T2? CPF ou
  CNPJ?), nunca "posso te mandar?".
- **Custo da inércia, com número dele**: quanto ele paga a mais por mês
  ficando onde está — só com dado que ele mesmo informou.

**Não usar:** urgência inventada, escassez falsa ("últimas unidades"), promessa
de aprovação ou de resultado, e qualquer número que ela não tenha na base. O
material da Ton trata isso como infração, e no CPI foi esse tipo de pressão que
gerou bloqueio de número.

### 8.5 Fim das perguntas de permissão

O lead `5521973174307` respondeu **"Sim" sete vezes** porque quase toda
mensagem terminava em "Quer que eu…?" / "Posso…?". Cada uma dessas é um turno
desperdiçado e uma chance a mais de o lead sumir.

Regra: quando ela já tem o diagnóstico, **manda** — link, comparação,
recomendação — e a pergunta final serve para AVANÇAR, não para autorizar.

Errado: "Se quiser, eu te mando o link da T2. Quer?"
Certo: "Segue a T2 <link>. Você prefere no CPF mesmo ou vai abrir CNPJ?"

### 8.6 Onde isso encosta no código

- `src/lib/agente/prompt.ts` — os três modos e os gatilhos entram como blocos
  de instrução condicionados ao estado do lead, no mesmo desenho da escada de
  ângulos do CPI (seção 5).
- Estado novo: "compra confirmada" não existe hoje. `estagio = convertido` é
  atribuído pela IA sem confirmação — foi o que aconteceu no caso 7.1. Precisa
  de campo próprio e de gatilho explícito.
- `src/lib/crm/regua.ts` — o toque 1 pós-link deixa de ser remarketing genérico
  e passa a ter função definida: **confirmar a compra**.
- Escalar por risco de comissão reusa `marcarPrecisaAtencao`, que já existe.
- Os casos golden (`src/lib/agente/casos-golden.ts`) precisam de um por regra
  desta seção — em especial "quero essa" NÃO virando suporte, e conta bloqueada
  escalando em vez de virar tutorial.

## 9. Reenquadramento do dono: o objetivo é CONVERSÃO

Direção dada em 08/08/2026, e ela reordena as seções acima: o foco é receber o
lead do anúncio e **vender**. Regra de programa não é critério de decisão aqui.

Reescrevendo os limites das seções 4 e 5 em termos de conversão — o que
sobrevive sobrevive porque **protege receita**, não porque é norma:

| limite | justificativa por regra (fraca) | justificativa por venda (a que vale) |
| --- | --- | --- |
| janela 21h–08h | "diretriz" | mensagem às 4h é denúncia e bloqueio. Número bloqueado = **conversão zero**, não conversão menor. E a taxa de resposta de madrugada é péssima: o mesmo toque às 8h vale mais. |
| parar após 3 recusas do destinatário | — | quem bloqueou não compra. Insistir marca o chip como spam e derruba a entrega **de todos os outros leads**. |
| não inventar urgência/escassez | "infração" | mentira descoberta mata a venda no ato e queima indicação. Urgência REAL (frete grátis, promo vigente) deve ser usada com força — o problema nunca foi urgência, foi urgência falsa. |
| teto de 4 toques + pausa de 30 dias | "perseguição, contra diretrizes" | **este cai.** Era o mais apoiado em norma e o menos apoiado em dado. O que deve governar é sinal: enquanto houver ângulo NOVO e o lead não estiver bloqueando nem pedindo para parar, continua. O corte vem da métrica (resposta, bloqueio), não de um número fixo. |

Ou seja: dos limites que eu tinha escrito, três continuam por razão comercial e
**um cai** — o teto rígido de toques passa a ser governado por sinal medido, não
por regra.

O que NÃO muda: `nao_perturbe` continua absoluto (quem pediu para parar não
recebe mais nada — insistir aí é o caminho mais rápido para denúncia), e a IA
não inventa número, taxa nem prazo. Os dois são proteção de receita, não
burocracia.

**Prioridade da fatia, nesta ordem:** (1) resgate pré-link, porque hoje 7 de 11
leads morrem sem nenhum toque; (2) os três modos de atendimento, porque ela
está entregando suporte antes de existir venda; (3) escada de ângulos, porque
reformular a mesma pergunta responde 27,8% contra 46,8% do ângulo novo;
(4) ciclo de aprendizado, para melhorar com o uso.

Material adicional do dono chega depois e entra nesta fatia.
