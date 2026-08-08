# Fatia 4 — verificação de ponta a ponta

Roteiro para rodar **junto com o dono**. Os passos 1 a 4 já foram exercitados
por mim no navegador e estão marcados; os passos 5 a 7 dependem de WhatsApp
real e de decisões que não são minhas.

Ambiente: `bun run dev` (confira a porta que o Vite anunciar — a 3000 costuma
estar ocupada). Login: `pedrodeyvson15@gmail.com`.

> **Todo lead no banco é REAL.** Os de demonstração foram apagados. Mudar
> estágio dispara conversão de verdade no Meta Ads, e a caixa de resposta manda
> mensagem para o WhatsApp de uma pessoa. Nada aqui deve ser feito "só para
> ver".

## O que precisa de você antes de começar

1. **Um número de teste** — seu segundo WhatsApp, ou de alguém avisado. Os
   passos 5, 6 e 7 mandam mensagem de verdade.
2. **Confirmar que o `META_PAGE_ID` está no ambiente de produção.** Eu gravei
   só no `.env` local. Sem ele, lead novo em produção continua sem evento —
   agora pulando com aviso no log, em vez de gravar erro.
3. **Desligar "Allow new users to sign up"** no Supabase (Authentication → Sign
   In / Providers → Email). O buraco de dados já está fechado no banco
   (`public.donos`), mas hoje qualquer pessoa ainda cria conta no projeto.

---

## Passo 1 — Autenticação ✅ verificado

- `/inbox` sem sessão redireciona para `/login?destino=%2Finbox` ✅
- Login volta para o destino ✅
- `getUser` valida contra o servidor, não só decodifica o cookie ✅
- Sessão expirada: **corrigido hoje** (`dc390e2`) — antes, apagar o cookie
  quebrava a tela com `mensagens.map is not a function`. **A confirmar com
  você:** apague o cookie `sb-` no devtools com a conversa aberta e confirme
  que vai ao login em vez de quebrar.

## Passo 2 — Lista de conversas ✅ verificado

- 14 linhas com `conversaId` e `leadId` reais, sem warning de rota ✅
  (estava tudo `disabled` antes de `5b626ff`)
- Ordem: mais recente primeiro; lead sem mensagem não sobe mais ao topo ✅
- Horário no fuso de São Paulo ✅
- "você assumiu" × "IA respondendo" corretos por conversa ✅
- Filtros Todas / Atenção / Você assumiu — **não exercitados**, só renderizados

## Passo 3 — Conversa e mídia ✅ verificado

- Histórico com bolhas distintas de Cliente e Mika ✅
- 3 elementos `<audio>` renderizados ✅
- **Não verificado:** imagem, vídeo, sticker e documento — não havia exemplo de
  cada tipo no banco. Se aparecer um, confira que a bolha não sai vazia.
- Página não rola; só o histórico ✅ (`c658165`)
- Rolar para cima e ficar lá sobrevive ao polling de 5s ✅
- **A confirmar com você:** chegar mensagem nova enquanto você lê o começo
  **não** deve puxar a tela para baixo.

## Passo 4 — Painel do lead ✅ verificado

- Alerta de atenção, estágio, "Veio de anúncio", notas, tarefas ✅
- Mudar estágio persiste após reload ✅
- Ciclo criar → concluir → excluir tarefa ✅
- Contadores na barra sobem e descem ✅
- **A confirmar com você:** "Marcar como resolvido" num lead que precisa de
  atenção. Não fiz porque altera um lead real.

---

## Passo 5 — Resposta manual (precisa de você)

Do seu número de teste, mande uma mensagem para o WhatsApp da operação.

1. A conversa aparece no topo do inbox em até 5s.
2. Abra e confira que o cabeçalho diz **"IA respondendo"**.
3. A caixa mostra o aviso *"ao responder, você assume a conversa e a IA para"*.
4. Escreva e envie.

**O que tem que acontecer:** a mensagem chega no seu celular; a bolha aparece
com a cor de humano (verde), diferente da IA; o cabeçalho passa a **"você
assumiu"**; e a lista mostra "você assumiu" naquela linha.

**O que tem que NÃO acontecer:** a Mika responder depois disso. Mande outra
mensagem do celular e confirme que ela fica calada — a pausa é o ponto todo.

## Passo 6 — Devolver para a IA (precisa de você)

Na mesma conversa, clique em **"Devolver para a IA"**.

Mande nova mensagem do celular: agora a Mika deve responder. Confirme que o
cabeçalho voltou para "IA respondendo".

Esse passo fecha o `recheck` da Task 7: o agente relê a pausa imediatamente
antes de enviar, então uma tomada de controle no meio do turno dele não vira
mensagem duplicada.

## Passo 7 — Reenvio de falha (precisa de você, e é o mais chato)

O único jeito honesto de ver uma mensagem `falhou` é fazer o envio falhar.
Opções, da menos destrutiva para a mais:

- **Melhor:** bloqueie o número da operação no seu celular de teste e responda
  por ali — a uazapi devolve recusa do destinatário.
- Alternativa: derrube a `UAZAPI_BASE_URL` no `.env` por um instante, tente
  enviar, e restaure.

**O que tem que acontecer:** a bolha aparece marcada como falha, com botão de
reenviar; clicar reenvia **na mesma linha** (não cria mensagem nova); e clicar
duas vezes rápido **não** manda duas mensagens — essa é a guarda de
compare-and-swap da Task 8, e é a única forma de vê-la funcionando.

---

## Ficha de resultado

Anote aqui o que acontecer. O que falhar vira correção antes de fechar a
branch.

| passo | resultado | observação |
| --- | --- | --- |
| 1 sessão expirada | | |
| 3 mensagem nova sem puxar a tela | | |
| 4 marcar como resolvido | | |
| 5 resposta manual | | |
| 5 IA fica calada depois | | |
| 6 devolver para a IA | | |
| 7 reenvio sem duplicar | | |

## Pendências conhecidas, que NÃO bloqueiam esta verificação

- O contador "N precisam de atenção" na barra só enxerga os 50 leads mais
  recentes e subestima em silêncio (ressalva da revisão da Task 12).
- A fila `/tarefas` ordena por `prazo`, mas nenhuma tela permite definir prazo
  — na prática toda tarefa nasce com `prazo` nulo.
- Tipagem `any` disseminada nas formas de lead, conversa e mensagem — herdada
  do plano.
- Dois leads reais chegaram sem `ctwa_clid` (um deles o que converteu) e por
  isso não geram evento na Meta. Investigar se é lead orgânico mesmo ou perda
  de clid na ingestão — está no caderno da Fatia 5/6.
