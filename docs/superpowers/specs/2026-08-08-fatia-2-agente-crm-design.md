# Fatia 2 — Camada CRM + Agente de IA

**Data:** 2026-08-08
**Status:** Aprovado para planejamento de implementação
**Depende de:** Fatia 1 (webhook UAZAPI → lead + mensagem), completa e em produção
**Spec-mãe:** `2026-08-07-crm-ia-renda-ton-design.md`

## O que esta fatia entrega

Hoje o sistema só recebe. Ao fim desta fatia ele **responde**: um lead manda mensagem no
WhatsApp e recebe de volta uma resposta do agente de IA, que qualifica, tira dúvidas com base
numa FAQ curada, envia o link de indicação na hora certa e escala para o Pedro quando não
deve arriscar.

Junto vem a **camada de funcionalidade de CRM** no padrão do CPI — mover estágio, registrar
evento, listar conversas e mensagens, marcar lida, enviar mensagem. Ela existe nesta fatia
porque o agente precisa dela; a Fatia 4 só põe telas por cima.

**Não entra:** RAG / base de conhecimento editável (Fatia 3), login e telas (Fatia 4), envio
de mídia pelo CRM (Fatia 5).

## Decisões desta fatia

- **Acionamento assíncrono com debounce.** O webhook grava e devolve 200 imediatamente; um
  processador separado espera o lead parar de digitar antes de acionar o agente. Motivo: uma
  falha do OpenAI dentro do webhook faria a UAZAPI reentregar o evento e o lead poderia
  receber resposta duplicada; e mensagem picada em três viraria três respostas.
- **Loop in-process no `server.ts`**, não pg_cron nem cron externo. O EasyPanel roda um
  container Node persistente, então um `setInterval` resolve sem infra nova e com
  granularidade de segundos — cron daria no mínimo 1 minuto de espera para o lead.
- **FAQ curada em arquivo versionado**, não conhecimento genérico do modelo. O guardrail do
  spec-mãe é nunca inventar política da Ton. O mesmo conteúdo vira seed do RAG na Fatia 3.
- **Núcleo puro + casca `createServerFn` depois.** A lógica de CRM fica em módulos que
  recebem o client `admin` por parâmetro — mesmo formato de `ingerirEvento(admin, body)` que
  já existe. Testável sem HTTP e sem autenticação, e chamável pelo agente. Na Fatia 4 as
  `createServerFn` com `requireSupabaseAuth` entram como casca fina por cima.
- **O agente nunca escreve o link.** O link vem de variável de ambiente; o modelo só decide
  *quando* enviá-lo, chamando uma tool.
- **Taxa é sempre escalada, nunca respondida.** Qualquer pergunta sobre taxa de débito,
  crédito, parcelado, Pix ou negociação por faturamento vira escalação para o Pedro, mesmo
  que a FAQ tenha o número. Elimina a categoria de erro mais cara do agente: falar um valor
  errado sobre o dinheiro do cliente.
- **Follow-up automático de uma tentativa só.** Lead que recebeu o link e não voltou leva uma
  mensagem depois de 24h — e nunca mais. Não é abordagem fria: retoma uma conversa que o
  próprio lead começou, o que respeita o "leads são só inbound" do spec-mãe e as regras de
  conduta anti-spam do programa. Uma tentativa só porque a instância UAZAPI é compartilhada
  com o CPI e uma marcação de spam derrubaria os dois projetos.
- **Modelo: `gpt-5.4-mini`.** O CPI não tem agente de IA para herdar modelo — o único modelo
  lá é o `whisper-large-v3-turbo` do Groq, que a Fatia 1 já copiou. A escolha é nova: o lead
  espera no WhatsApp, então latência e custo pesam tanto quanto capacidade, e a tarefa é
  conversa guiada por FAQ curada com três tools, não raciocínio pesado. O golden set dirá se
  precisa subir para `gpt-5.5`.

## Fluxo

```
webhook UAZAPI (já existe)
  └─ grava mensagem do lead
       └─ se remetente=lead, conversa não pausada e lead sem precisa_atencao:
            conversas.responder_em = now() + JANELA_DEBOUNCE

loop in-process (server.ts, tick de 3s)
  └─ UPDATE conversas SET processando_em = now()
       WHERE responder_em <= now() AND processando_em IS NULL
       RETURNING *          -- o próprio UPDATE é o lock; nada de SELECT depois
            └─ agente:
                 monta prompt (persona + FAQ + estado do lead + histórico)
                 → OpenAI com tools
                 → executa tool calls
                 → grava mensagem status='pendente'
                 → envia via UAZAPI
                 → marca status='enviada' + provider_message_id
            └─ limpa responder_em e processando_em
```

Mensagem picada vira um turno só: cada nova mensagem do lead **reagenda** o `responder_em`,
então a janela só fecha depois que ele para de escrever.

## Modelo de dados (migração `20260808_agente.sql`)

**`conversas`** ganha:
`responder_em timestamptz` (null = nada pendente), `motivo_agendamento text check in
('resposta','followup')`, `processando_em timestamptz` (lock do worker), `tentativas integer
default 0`, `ultimo_erro text`, `followup_enviado boolean default false`.
Índice parcial `(responder_em) where responder_em is not null` — o loop consulta a cada 3s.

O follow-up **reusa o mesmo agendamento** da resposta: quando o link é enviado, grava
`responder_em = now() + FOLLOWUP_HORAS` com `motivo_agendamento = 'followup'`. Um loop, um
lock, um caminho de erro. E o cancelamento sai de graça: se o lead responder antes, o webhook
reagenda com `motivo = 'resposta'` e o follow-up simplesmente deixa de existir.

**`tarefas`** (nova, molde do `crm_tasks` do CPI sem a parte de multi-tenancy):
`id`, `lead_id`, `titulo`, `descricao`, `prazo timestamptz`, `concluida boolean default
false`, `concluida_em`, `criado_em`. Índice `(concluida, prazo)` e `(lead_id)`.
São os lembretes que o Pedro cria à mão — a IA não escreve aqui.

**`mensagens`** ganha:
`status text check (status in ('pendente','enviada','falhou'))`. Mesmo papel do `status` em
`crm_messages` no CPI: a mensagem da IA é gravada **antes** do envio, então nada que o lead
recebeu fica fora do histórico, e nada que falhou some sem deixar rastro.

**`leads`** ganha:
`estagio_alterado_em timestamptz`, `link_enviado_em timestamptz`, `motivo_perdido text`.

O CPI usa uma coluna de data por etapa (`data_qualificado`, `data_reuniao`, …), mas ali são 5
estágios e aqui são 8. O histórico completo de transições fica em `eventos_lead`, que já
existe; só as datas que o dashboard da Fatia 4 realmente consulta viram coluna.

## Módulos

### Camada CRM — `src/lib/crm/`

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `estagios.ts` | Ordem dos estágios, transições válidas, qual data carimbar. **Puro.** | nada |
| `leads.server.ts` | `obterLead`, `atualizarLead`, `moverEstagio`, `marcarPrecisaAtencao`, `registrarNota` | `admin`, `estagios` |
| `conversas.server.ts` | `listarConversas`, `obterConversa`, `marcarLida`, `pausarIa`, `retomarIa`, `agendarResposta` | `admin` |
| `mensagens.server.ts` | `listarMensagens`, `enviarTextoDoCrm` (grava pendente → UAZAPI → enviada) | `admin`, cliente UAZAPI |
| `tarefas.server.ts` | `listarTarefas`, `criarTarefa`, `alternarTarefa`, `excluirTarefa` | `admin` |

`moverEstagio` grava um registro em `eventos_lead` com `{de, para}` — é o que alimenta o
funil da Fatia 4, no mesmo espírito do `crm_lead_eventos` do CPI.

`enviarTextoDoCrm` é usada tanto pelo agente (`remetente='ia'`) quanto pelo Pedro na Fatia 5
(`remetente='humano'`), com o remetente como parâmetro. Uma implementação só.

### Agente — `src/lib/agente/`

| Arquivo | Responsabilidade | Puro? |
|---|---|---|
| `conhecimento.ts` | A FAQ curada da Renda Ton | sim |
| `prompt.ts` | Monta o system prompt a partir de persona + FAQ + estado do lead | sim |
| `politica.ts` | Decide se o agente deve responder e monta a janela de histórico | sim |
| `tools.ts` | Definição das tools e execução delas contra a camada CRM | definição pura |
| `agente.server.ts` | Orquestra o turno: prompt → OpenAI → tools → resposta | não |
| `openai.server.ts` | Cliente OpenAI (lê env, timeout, erro tipado) | não |

### Worker — `src/lib/worker/loop.server.ts`

O `setInterval`, o lock e o backoff. Plugado no `server.ts` da raiz. Não roda em teste.

## Tools do agente

| Tool | Argumentos | Efeito |
|---|---|---|
| `atualizar_lead` | `nome?`, `maquina_interesse?`, `estagio?` | Atualiza o lead; `estagio` passa por `moverEstagio` e gera evento |
| `registrar_link_enviado` | — | Devolve o link de `TON_LINK_INDICACAO` para o modelo colar na resposta, move para `link_enviado`, carimba `link_enviado_em` e **agenda o follow-up** para daqui a `FOLLOWUP_HORAS` |
| `escalar_para_humano` | `motivo` | `precisa_atencao = true`, `pausada_pela_ia = true`, grava evento. O agente **não** responde neste turno |

`consultar_estado_lead` do spec-mãe **sai**: o estado do lead já viaja no system prompt, então
a tool só gastaria um round-trip para devolver o que o modelo já tem.

`buscar_base_conhecimento` fica para a Fatia 3, quando existir o que buscar.

## Comportamento do agente

**Persona:** fala em nome do Pedro, consultor Ton. Nunca se apresenta como funcionária da
Ton — é regra do programa Renda Ton.

**Envio do link:** só depois de qualificar (tipo de negócio, o que o lead vende, qual máquina
faz sentido) e quando o lead demonstra intenção — pergunta como pegar, diz que quer. Não
manda na primeira menção a maquininha.

**Escala e para de responder quando:**
1. **Qualquer pergunta sobre taxa** — débito, crédito, parcelado, Pix, negociação por
   faturamento. Sempre, mesmo que a FAQ tenha o número. Regra dura, não julgamento do modelo.
2. O lead pede para falar com pessoa — inclusive de forma indireta ("é robô?", "me liga").
3. O lead está irritado, ou o assunto é reclamação / suporte pós-venda. O suporte oficial é
   da própria Ton; o consultor só orienta.
4. A pergunta é sobre prazo ou política da Ton e a resposta **não está na FAQ**.

Não há escalação por contagem de mensagens — decisão explícita do dono. O controle de custo
vem da janela de histórico, não de desligar o agente.

**Follow-up:** 24h depois de `registrar_link_enviado`, se o lead não voltou, o agente manda
uma mensagem só, perguntando se conseguiu concluir o cadastro, e move o lead para
`acompanhamento`. Marca `followup_enviado = true` e nunca mais inicia conversa naquele lead.
Se o lead respondeu no meio-tempo, o follow-up já foi cancelado pelo reagendamento e nada
acontece. Se a conversa está pausada ou o lead já foi escalado, o follow-up não dispara.

**Janela de histórico:** as últimas 30 mensagens da conversa. Áudio entra pela transcrição
(`transcricao`), não pelo arquivo. Imagem entra nesta fatia como marcador de texto
(`[o lead enviou uma imagem]`) — visão fica fora do escopo desta fatia.

## Erros

| Falha | Comportamento |
|---|---|
| OpenAI indisponível ou timeout | `tentativas++`, `responder_em = now() + 30s · 2^tentativas`, `ultimo_erro` preenchido |
| 3ª tentativa falha | `precisa_atencao = true`, `responder_em = null`. Para de tentar; o Pedro assume |
| UAZAPI falha no envio | A mensagem já gravada vira `status='falhou'`. Mesmo backoff |
| Container reinicia no meio | `processando_em` mais velho que 2 minutos é considerado órfão e liberado no próximo tick |
| Tool call com argumento inválido | Erro devolvido ao modelo como resultado da tool, que tenta de novo no mesmo turno (máx. 3 iterações de tool) |

O webhook nunca é afetado por nada disso — ele já respondeu 200 antes do agente entrar.

## Testes

`node --test --experimental-strip-types`, mesmo padrão da Fatia 1. Imports com extensão
`.ts` explícita e sem alias `@/` nos módulos testados.

**Puro:**
- `estagios.ts` — transições válidas e inválidas, carimbo de data correto, volta de estágio
- `politica.ts` — não responde com conversa pausada, com `precisa_atencao`, ou quando a
  última mensagem é da própria IA; agrupa mensagens dentro da janela de debounce
- follow-up — agenda ao enviar o link; o reagendamento por mensagem do lead cancela;
  não dispara duas vezes; não dispara com conversa pausada nem lead escalado
- `prompt.ts` — o link nunca aparece no prompt; estado do lead presente; FAQ presente
- `tools.ts` — schema das tools, validação de argumentos

**Com `admin` mockado:**
- `agente.server.ts` — turno feliz, turno que escala, turno com tool inválida, backoff
- `mensagens.server.ts` — grava pendente antes de enviar; marca falhou quando a UAZAPI erra

**Golden set** (`AGENTE_GOLDEN=1`, fora da suíte padrão): conversas simuladas contra o OpenAI
real — FAQs, objeções comuns, casos que devem escalar. Roda a cada mudança de prompt ou de
FAQ para pegar regressão de comportamento. Não roda no `npm test` porque custa dinheiro e é
não-determinístico.

## Variáveis de ambiente novas

| Variável | Papel |
|---|---|
| `OPENAI_API_KEY` | Já existe no `.env` |
| `OPENAI_MODEL` | `gpt-5.4-mini` |
| `TON_LINK_INDICACAO` | Link de indicação do Pedro. **Pendente.** O agente nunca escreve o link à mão |
| `AGENTE_ATIVO` | `true`/`false` — mata o agente sem redeploy se ele começar a falar besteira |
| `AGENTE_DEBOUNCE_MS` | Padrão `8000` |
| `FOLLOWUP_HORAS` | Padrão `24`. `0` desliga o follow-up |

---

# Esqueleto da FAQ — PARA O PEDRO CORRIGIR

> Tudo marcado `[PREENCHER]` é fato que eu **não** posso inventar: taxa, prazo, preço e
> regra da Ton. Onde eu escrevi algo, é rascunho e precisa da sua conferência.
> Este bloco vira `src/lib/agente/conhecimento.ts` na implementação.

## Sobre o consultor e o programa

- A IA fala **como o Pedro**, consultor parceiro da Ton. Nunca "sou da Ton".
- O que o consultor faz: orienta na escolha da máquina e envia o link de cadastro.
- O que o consultor **não** faz: suporte pós-venda, desbloqueio de conta, estorno,
  problema de recebimento. Isso é com a Ton — `[PREENCHER: canal oficial que você indica]`.

## As máquinas

Para cada modelo, precisa: para quem serve, preço, e o que a diferencia da de baixo.

| Modelo | Para quem serve | Preço | Diferencial |
|---|---|---|---|
| TapTon (celular como maquininha) | `[PREENCHER]` | `[PREENCHER]` | `[PREENCHER]` |
| T1 | `[PREENCHER]` | `[PREENCHER]` | `[PREENCHER]` |
| T2 | `[PREENCHER]` | `[PREENCHER]` | `[PREENCHER]` |
| T3 | `[PREENCHER]` | `[PREENCHER]` | `[PREENCHER]` |
| T3 Smart | `[PREENCHER]` | `[PREENCHER]` | `[PREENCHER]` |
| Stone (maquininha Stone) | `[PREENCHER]` | `[PREENCHER]` | `[PREENCHER]` |

**Pergunta que decide o modelo:** `[PREENCHER: o que você pergunta pro cliente pra saber qual
indicar? faturamento? tem wi-fi? precisa de comprovante impresso?]`

## Taxas — a IA nunca responde

Decidido: **toda** pergunta sobre taxa (débito, crédito, parcelado, Pix, negociação por
faturamento) escala para o Pedro. Não há número de taxa em lugar nenhum da FAQ, então nem o
acidente é possível.

O que a IA diz antes de escalar: `[PREENCHER: a frase que você quer que ela use. rascunho —
"Taxa eu prefiro te passar certinho, deixa eu confirmar aqui e já te respondo"]`

**Prazo de recebimento** é assunto separado de taxa. Se você quiser que ela responda:
`[PREENCHER: prazo de recebimento — ou escreva "escalar" que eu trato igual à taxa]`

## Como o cliente compra (o caminho do link)

1. `[PREENCHER: o que acontece quando ele clica no link]`
2. `[PREENCHER: que dados ele precisa ter em mãos — CNPJ? MEI serve? CPF sozinho serve?]`
3. `[PREENCHER: prazo de aprovação]`
4. `[PREENCHER: prazo e forma de entrega]`
5. `[PREENCHER: como ele ativa a máquina quando chega]`

## Objeções que você já ouviu

Rascunho meu — corrija a resposta e acrescente as que faltam.

| Objeção | Resposta |
|---|---|
| "Tá caro" | `[PREENCHER]` |
| "Já tenho maquininha do concorrente" | `[PREENCHER]` |
| "Vou pensar" | `[PREENCHER]` |
| "Preciso de CNPJ?" | `[PREENCHER]` |
| "E se der problema?" | `[PREENCHER]` |
| "Tem mensalidade / aluguel?" | `[PREENCHER]` |
| `[acrescente as suas]` | |

## Follow-up de 24h

A mensagem que a IA manda quando o lead recebeu o link e sumiu.
Rascunho: `[PREENCHER: "Oi {nome}, conseguiu concluir o cadastro? Se travou em alguma parte
me fala que eu te ajudo"]` — corrija para soar como você.

## O que a IA nunca fala

- Valor da **sua** comissão. Isso é informação interna, jamais vai para o lead.
- Qualquer taxa, prazo ou regra que não esteja escrita acima.
- Promessa de aprovação, de prazo de entrega ou de valor de recebimento.
- Comparação depreciativa com concorrente — regra de conduta do programa.

## Tom

`[PREENCHER: como você fala com cliente? você manda áudio? usa emoji? chama de "você" ou pelo
nome? manda mensagem curta ou explica tudo de uma vez?]`

Rascunho: mensagens curtas, uma ideia por mensagem, sem emoji em excesso, trata por você,
sempre termina com uma pergunta para manter a conversa andando.
