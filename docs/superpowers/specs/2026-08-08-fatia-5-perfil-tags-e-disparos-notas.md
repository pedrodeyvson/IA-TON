# Fatia 5 (a fazer): perfil do WhatsApp, tags no inbox e payload dos disparos

Notas de investigação levantadas em 08/08/2026, **antes** de escrever o plano.
Decidido com o dono que esta fatia entra **depois** da Fatia 4 fechar — nome/foto
e tags mexem em `ListaConversas.tsx` e `PainelLead.tsx`, os mesmos arquivos das
Tasks 12/13 em andamento.

## O escopo pedido

1. Nome e foto reais do WhatsApp aparecendo no CRM.
2. Tag de origem Meta Ads visível (hoje só existe o bloco "Veio de anúncio" no
   painel).
3. O payload e a resposta de cada disparo CAPI visíveis dentro do lead.
4. Tags no inbox: estágio e máquina de interesse na linha da lista.

## uazapi: `/chat/details` — resposta REAL, não deduzida

Testado contra `https://cpiebx.uazapi.com` com o token da instância em
08/08/2026. `POST /chat/details`, header `token`, corpo
`{ number, preview: false }`. `/chat/GetNameAndImageURL` devolveu resposta
idêntica — são o mesmo endpoint por dois nomes.

Campos que voltam:

```json
{
  "id": "r0a918b43d61b53",
  "name": "Pedro",
  "wa_name": "Pedro Deyvson",
  "wa_contactName": "Pedro",
  "image": "https://pps.whatsapp.net/v/t61.24694-24/621177679_...",
  "imagePreview": "…(~220 chars)",
  "phone": "+55 84 8777-8591",
  "wa_chatid": "558487778591@s.whatsapp.net",
  "wa_chatlid": "200627200217148@lid",
  "lead_name": "", "lead_fullName": "", "lead_tags": [],
  "wa_label": [], "wa_common_groups": "", "owner": "558486855652",
  "wa_fastid": "558486855652:558487778591"
}
```

Amostra de 6 contatos reais: 5 tinham `name`/`wa_name` preenchido, 4 tinham
`image`, 1 tinha `wa_contactName` (só quem está na agenda do número).
`imagePreview` veio vazio em 1 dos que tinham `image` — não dá para tratar como
sempre presente.

**O ganho é imediato e mensurável.** Estado do nosso banco hoje contra o que o
WhatsApp responde:

| telefone | `leads.nome` hoje | WhatsApp | foto |
| --- | --- | --- | --- |
| 559881639238 | `"61006359338"` (lixo numérico) | D Estofados | não |
| 557598196863 | `null` | jozejozeaparecidosantana | sim |
| 559491407827 | `null` | Beth | sim |
| 5522998221109 | `null` | Elmo Dutra Soares | sim |
| 557588028564 | `null` | germanoribeirosanttos | sim |
| 558287042709 | `null` | Marcelo Guedes | não |

## Como o CPI faz (`src/lib/uazapi/profile.ts`)

- Prioridade de nome: `wa_contactName` > `name` > `wa_name`.
- **Só sobrescreve nome placeholder** — `null`, vazio, começando com
  "WhatsApp ", igual ao telefone, ou só dígitos. Preserva edição manual do
  operador, que é o ponto principal da função `isPlaceholderName`.
- A URL de `pps.whatsapp.net` **expira**: o CPI baixa a imagem e re-hospeda no
  Storage, gravando a URL permanente em `foto_url`. Guardar o link direto do
  WhatsApp não funciona.
- Best-effort: nunca lança, devolve flags do que atualizou.
- Gatilhos: lead novo no ingest (`ingest.ts:516`) e backfill quando o lead
  ainda não tem foto E a mensagem é de ENTRADA (`ingest.ts:713-727`) — a
  condição `!fromMe` existe para não martelar a API a cada mensagem enviada.

### Diferença deliberada em relação ao CPI

O CPI usa bucket **público** (`crm-avatars`). **Aqui vai ser privado com URL
assinada** — decisão do dono. Motivo: foto de lead é dado pessoal, e o projeto
já trata mídia de mensagem como privada (`obterUrlDeMidia`, assinada por 5
min); bucket público contradiria isso e deixaria a foto acessível a qualquer um
com o link, sem login. Custo aceito: uma chamada em lote para assinar as URLs
das até 50 linhas da lista.

## Payload dos disparos CAPI

`eventos_capi` hoje tem `id, lead_id, nome_evento, event_id, enviado_em,
status_resposta, criado_em`. **Não guarda o payload nem a resposta** — só o
`status_resposta` truncado em 200 chars.

Foi exatamente essa lacuna que escondeu a causa do bug do `page_id` por um dia:
`"Invalid parameter"` sozinho não diz nada. O commit `d9ddf7f` já melhorou o
texto guardado (subcode + `error_user_msg`), mas o payload continua perdido.

O CPI guarda tudo em `crm_leads.capi_disparos` via RPC `append_capi_disparo`,
com `{ evento, event_id, enviado_em, payload, resposta, ok, erro }` — é o que
alimenta o painel "Disparos CAPI (Meta)".

A fazer: migration acrescentando `payload jsonb` e `resposta jsonb` a
`eventos_capi`, gravação em `capi.server.ts`, e um bloco no painel do lead.
Atenção ao escrever: o payload contém `ph`/`external_id` hasheados e o
`ctwa_clid` em texto puro. Fica só para o dono, atrás de `exigirSessao`.

## Armadilha que já custou caro nesta base

Ao escrever teste que dubla retorno do Supabase/PostgREST, **confira o formato
real** em vez de deduzir do `.select()`. O embed `conversas(...)` volta como
OBJETO (relação to-one, `lead_id` é UNIQUE), não array — `rotulos.test.ts`
dublava array, ficou verde por três tasks e o inbox inteiro estava morto
(corrigido em `5b626ff`). O mesmo vale para qualquer coisa nova aqui.

## Adendo (mesmo dia): mais pedidos do dono para esta fatia

6. **Horário dentro da própria conversa**, em cada bolha — não só na lista.
   Reusar `rotuloDeHorario` de `src/components/crm/rotulos.ts` (já fixa o fuso
   em America/Sao_Paulo para SSR e cliente concordarem).
7. **Tag visível de autoria na bolha da IA.** Hoje `Bolha.tsx` já usa três
   cores por `remetente` (lead/ia/humano) e escreve "Cliente"/"Mika", mas o
   dono quer um marcador explícito de que aquela mensagem foi da IA.
8. **Tags e marcadores no inbox e no kanban**, replicando o CPI: etapa em que
   o lead está, máquina de interesse, e origem Meta Ads como tag na linha da
   lista (hoje só existe o bloco "Veio de anúncio" dentro do painel).

### O que o CPI tem de tags — levantado, mas AINDA NÃO É SUFICIENTE

`crm_leads.tags` é um `string[]` (`types.ts:591`) — tags livres por lead, sem
tabela própria. Além disso existe `crm_custom_stages` (`crm_leads.custom_stage_id`),
que são colunas de kanban configuráveis por organização, com
`CustomStagesManager.tsx` para administrá-las.

**Cuidado ao replicar:** o CPI é multi-org e tem kanban com colunas
configuráveis; este projeto é de uso individual e tem funil FIXO de 8 estágios
(`src/lib/crm/estagios.ts`), com mapeamento fixo para os eventos CAPI
(`capi.constants.ts:60`). Copiar `custom_stages` quebraria esse mapeamento.
Antes de implementar, confirmar com o dono se ele quer tags LIVRES (rótulo que
ele digita) ou só os marcadores derivados que já existem (estágio, máquina,
origem) — são coisas diferentes e o pedido comporta as duas leituras.
