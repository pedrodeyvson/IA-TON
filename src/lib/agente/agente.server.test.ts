import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "../crm/admin-fake.ts";
import { executarTurno } from "./agente.server.ts";

const CTX = { conversaId: "C1", leadId: "L1", motivo: "resposta" as const };
const TOQUE = { ...CTX, motivo: "followup" as const };
const AGORA = Date.now();

function adminDeConversa(sobrescreve: Record<string, any> = {}) {
  return criarAdminFake({
    "conversas.select": {
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: false,
        followup_toque: 0, ciclo_pausado_ate: null,
      },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "qualificando",
        precisa_atencao: false, nao_perturbe: false, maquina_interesse: null,
        link_enviado_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [
        { remetente: "lead", tipo: "texto", conteudo: "oi, quero uma maquininha", timestamp_ms: AGORA },
      ],
      error: null,
    },
    "mensagens.insert": { data: { id: "M1" }, error: null },
    ...sobrescreve,
  });
}

test("turno feliz responde e envia o texto do modelo", async () => {
  process.env.AGENTE_ATIVO = "true";
  const admin = adminDeConversa();
  const enviados: string[] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "Oi Ana! Qual o seu tipo de negócio?", toolCalls: [] }),
    enviar: async (_n: string, t: string) => { enviados.push(t); return { messageid: "WA1" }; },
  });

  assert.equal(r.status, "respondeu");
  assert.deepEqual(enviados, ["Oi Ana! Qual o seu tipo de negócio?"]);
});

test("conversa pausada é pulada sem chamar a OpenAI", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: true, followup_toque: 0, ciclo_pausado_ate: null },
      error: null,
    },
  });
  let chamou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => { chamou = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({}),
  });

  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "conversa_pausada");
  assert.equal(chamou, false, "não pode gastar token numa conversa pausada");
});

test("conversa pausada durante a chamada ao modelo não envia", async () => {
  // A pausa chega depois de decidirTurno e antes do envio — exatamente a
  // janela que o inbox da Fatia 4 abriu. O flag é virado de dentro do dublê
  // do MODELO (chamar), não por contagem de leituras: contar leituras só
  // pinaria "existe uma segunda consulta", e um recheck colocado logo depois
  // de decidirTurno — antes da chamada ao modelo — também passaria nisso sem
  // consertar nada, porque a janela que importa é a da chamada ao modelo.
  // Virando o flag dentro de `chamar`, o teste amarra a ordem de verdade: a
  // pausa só existe depois que o modelo já respondeu.
  let pausada = false;
  const admin = adminDeConversa({
    "conversas.select": () => ({
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: pausada,
        followup_toque: 0, ciclo_pausado_ate: null,
      },
      error: null,
    }),
  });

  let enviou = false;
  const r = await executarTurno(admin, CTX, {
    chamar: async () => {
      pausada = true; // o Pedro assumiu ENQUANTO o modelo respondia
      return { texto: "resposta da IA", toolCalls: [] };
    },
    enviar: async () => { enviou = true; return { messageid: "prov-1" }; },
  });

  assert.equal(enviou, false);
  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "pausada_durante_o_turno");
});

test("falha ao reler a pausa não envia — vai como erro para o worker tentar de novo", async () => {
  // Sem conseguir ler o estado, não dá para afirmar que ninguém assumiu. E
  // "erro" em vez de "pulado" porque o worker dá retry com backoff no
  // primeiro e desiste no segundo (loop.server.ts / conversas.server.ts) —
  // uma falha transitória de leitura deve atrasar a resposta, não engoli-la.
  let leituras = 0;
  const admin = adminDeConversa({
    "conversas.select": () => {
      leituras += 1;
      return leituras === 1
        ? { data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 0, ciclo_pausado_ate: null }, error: null }
        : { data: null, error: { message: "connection reset" } };
    },
  });

  let enviou = false;
  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "resposta da IA", toolCalls: [] }),
    enviar: async () => { enviou = true; return { messageid: "prov-1" }; },
  });

  assert.equal(enviou, false);
  assert.equal(r.status, "erro");
  assert.match(r.motivo ?? "", /connection reset/i);
});

test("lead com nao_perturbe é pulado sem gastar token", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "link_enviado",
        precisa_atencao: false, nao_perturbe: true,
      },
      error: null,
    },
  });
  let chamou = false;

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => { chamou = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({}),
  });

  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "nao_perturbe");
  assert.equal(chamou, false);
});

test("pedido de parada no texto do lead não passa pelo modelo", async () => {
  // Rede de segurança: opt-out não depende do julgamento do modelo.
  const admin = adminDeConversa({
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "me tira dessa lista", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let chamou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => { chamou = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({}),
  });

  assert.equal(r.status, "escalou");
  assert.equal(chamou, false);
  const lead = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(lead?.payload.nao_perturbe, true);
});

test("tool call é executada e o modelo é chamado de novo com o resultado", async () => {
  process.env.TON_REFERRER = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";
  const admin = adminDeConversa();
  const chamadas: any[][] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      chamadas.push(mensagens);
      if (chamadas.length === 1) {
        return {
          texto: null,
          toolCalls: [{ id: "c1", nome: "registrar_link_enviado", argumentos: { produto: "catalogo" } }],
        };
      }
      return { texto: "Manda ver, é só entrar por aqui", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  assert.equal(chamadas.length, 2, "tem que voltar ao modelo com o resultado da tool");
  assert.ok(chamadas[1].some((m: any) => m.role === "tool"), "o resultado entra como role:tool");
});

// Achado da revisão final da branch: a tool registrar_link_enviado agenda o
// toque 1 direto no banco (agendarToque), mesmo quando ctx.motivo === "resposta"
// (o lead pediu o link no meio de uma conversa normal, não numa automação de
// régua). Antes desta correção, o turno devolvia { status: "respondeu", texto }
// sem reagendou, e o worker (loop.server.ts) via reagendou ausente e chamava
// limparAgendamento — apagando o responder_em/motivo_agendamento que a tool
// tinha acabado de gravar. A régua de follow-up nunca disparava pela primeira
// vez neste fluxo, que é o caminho principal (não uma automação).
test("link enviado no meio de uma conversa normal reagenda o toque 1 sem o worker apagar", async () => {
  process.env.TON_REFERRER = "CEA4255F-0783-4EAD-AA55-48C682BA8FA7";
  const admin = adminDeConversa();
  const chamadas: any[][] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      chamadas.push(mensagens);
      if (chamadas.length === 1) {
        return {
          texto: null,
          toolCalls: [{ id: "c1", nome: "registrar_link_enviado", argumentos: { produto: "catalogo" } }],
        };
      }
      return { texto: "Segue o link, qualquer coisa me chama", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  assert.equal(
    r.reagendou,
    true,
    "a tool já gravou o toque 1 no banco; sem reagendou o worker apagaria esse agendamento",
  );

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.ok(
    updates.some((u) => u.payload.motivo_agendamento === "followup"),
    "registrar_link_enviado tem que ter agendado o toque 1",
  );
});

test("escalação encerra o turno sem enviar mensagem", async () => {
  const admin = adminDeConversa();
  let enviou = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({
      texto: null,
      toolCalls: [{ id: "c1", nome: "escalar_para_humano", argumentos: { motivo: "quer negociar taxa" } }],
    }),
    enviar: async () => { enviou = true; return {}; },
  });

  assert.equal(r.status, "escalou");
  assert.equal(enviou, false);
});

test("lead convertido e com compra confirmada conversa em modo pós-venda", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "convertido",
        precisa_atencao: false, nao_perturbe: false,
        compra_confirmada_em: new Date(AGORA - 3_600_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "meu cadastro deu pendência", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let system = "";

  await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      system = mensagens[0].content;
      return { texto: "Vamos resolver: abre o app e veja o que ele pede", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.match(system, /Tente resolver/);
  assert.match(system, /ajuda\.ton\.com\.br/);
  assert.equal(system.includes("Quebra de objeções"), false);
});

// ===================== Fatia 6, Task 4: três modos com confirmação real =====================
// spec §8.1: só `compra_confirmada_em` decide "pos_venda" — nunca mais o
// estágio sozinho (era o defeito do caso real, spec §7/§11 Minor 9).

test('estágio "convertido" sozinho, sem compra_confirmada_em, NÃO muda o modo para pós-venda', async () => {
  // Regressão direta do achado da spec: antes desta task, `definirModo` olhava
  // só `estagio`, e um lead podia cair em "convertido" sem confirmação
  // nenhuma (foi o que aconteceu com "quero essa" no caso real). Depois desta
  // task, `definirModo` nem aceita mais `estagio` — só `compraConfirmadaEm`.
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "convertido",
        precisa_atencao: false, nao_perturbe: false, link_enviado_em: null,
        compra_confirmada_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "quero essa", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let system = "";

  await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      system = mensagens[0].content;
      return { texto: "Show! Vamos fechar então?", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  // Continua em "venda": tem a tabela de taxas/objeções, NÃO tem o roteiro de
  // pós-venda ("Tente resolver", que só entra no modo pos_venda de verdade).
  assert.match(system, /Quebra de objeções/);
  assert.equal(system.includes("Tente resolver"), false);
});

test("link enviado sem confirmação: modo continua venda, mas com o bloco de CONFIRMAÇÃO (não vira suporte)", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 3_600_000).toISOString(),
        compra_confirmada_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "consegui fazer o cadastro só que travou numa parte", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let system = "";

  await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      system = mensagens[0].content;
      return { texto: "Me conta o que travou que eu te ajudo", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  // Modo "venda" de verdade (não um terceiro modo): a tabela de taxas segue lá.
  assert.match(system, /Quebra de objeções/);
  assert.equal(system.includes("Tente resolver"), false, "não é o roteiro completo de pós-venda");
  // Mas ganha o bloco de acompanhamento ativo da CONFIRMAÇÃO.
  assert.match(system, /conseguiu finalizar o cadastro/i);
});

test('vira "pos_venda" só DEPOIS que registrar_resultado_compra grava "comprou" — não no mesmo turno em que "quero essa" aparece', async () => {
  // Turno 1: o lead só demonstra intenção. O modelo NÃO deveria chamar
  // registrar_resultado_compra aqui (isso é regra de prompt, coberta pelos
  // golden cases) — o que este teste prova é a metade de CÓDIGO: mesmo que o
  // modelo relute e não chame a tool, nada no turno grava compra_confirmada_em
  // sozinho.
  const adminIntencao = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "apresentando_solucao",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 3_600_000).toISOString(),
        compra_confirmada_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "quero essa", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let systemIntencao = "";
  await executarTurno(adminIntencao, CTX, {
    chamar: async (mensagens: any[]) => {
      systemIntencao = mensagens[0].content;
      return { texto: "Perfeito! Só confirma: é CPF ou CNPJ pra eu já preencher certo?", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });
  assert.match(systemIntencao, /Quebra de objeções/, "turno 1 continua em modo venda");
  assert.equal(
    adminIntencao.chamadas.some(
      (c: any) => c.tabela === "leads" && c.operacao === "update" && c.payload.compra_confirmada_em !== undefined,
    ),
    false,
    "nada grava compra_confirmada_em sem a tool ter sido chamada com 'comprou'",
  );

  // Turno 2: agora o lead confirma de verdade, e o modelo chama a tool.
  const adminConfirma = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 3_600_000).toISOString(),
        compra_confirmada_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "finalizei o cadastro agora", timestamp_ms: AGORA }],
      error: null,
    },
  });
  const chamadas: any[][] = [];
  await executarTurno(adminConfirma, CTX, {
    chamar: async (mensagens: any[]) => {
      chamadas.push(mensagens);
      if (chamadas.length === 1) {
        return {
          texto: null,
          toolCalls: [{ id: "c1", nome: "registrar_resultado_compra", argumentos: { resultado: "comprou", detalhe: "finalizei o cadastro agora" } }],
        };
      }
      return { texto: "Show, bora deixar tudo certinho no cadastro então", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  const confirmacao = adminConfirma.chamadas.find(
    (c: any) => c.tabela === "leads" && c.operacao === "update" && c.payload.compra_confirmada_em !== undefined,
  );
  assert.ok(confirmacao, "a tool grava compra_confirmada_em quando chamada com 'comprou'");

  // Turno 3 (o PRÓXIMO turno, já com compra_confirmada_em no banco): só agora
  // o modo vira pos_venda de verdade.
  const adminPosVenda = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "convertido",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 3_600_000).toISOString(),
        compra_confirmada_em: confirmacao!.payload.compra_confirmada_em,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "e agora, o que eu faço?", timestamp_ms: AGORA }],
      error: null,
    },
  });
  let systemPosVenda = "";
  await executarTurno(adminPosVenda, CTX, {
    chamar: async (mensagens: any[]) => {
      systemPosVenda = mensagens[0].content;
      return { texto: "Vamos lá: abre o app e me conta o que aparece", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });
  assert.match(systemPosVenda, /Tente resolver/, "só agora, com compra_confirmada_em gravado, entra pós-venda");
});

test("o toque injeta a instrução do ângulo daquele número", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 1, ciclo_pausado_ate: null },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 5 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "conseguiu concluir?", timestamp_ms: AGORA - 3 * 86_400_000 }],
      error: null,
    },
  });
  let instrucoes: string[] = [];

  const r = await executarTurno(admin, TOQUE, {
    chamar: async (mensagens: any[]) => {
      instrucoes = mensagens.filter((m: any) => m.role === "system").map((m: any) => m.content);
      return { texto: "O que pesou na hora de decidir?", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  const gatilho = instrucoes[instrucoes.length - 1];
  assert.match(gatilho, /toque 2 de 4/);
  assert.match(gatilho, /objeção real/);
  assert.match(gatilho, /não invente prazo/i);
});

test("depois de enviar o toque, o próximo é agendado e o resultado avisa", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 1, ciclo_pausado_ate: null },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 2 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "oi", timestamp_ms: AGORA - 2 * 86_400_000 }],
      error: null,
    },
  });

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => ({ texto: "e aí, o que pesou?", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, true, "o worker não pode apagar o toque recém-agendado");

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  assert.ok(updates.some((u) => u.payload.followup_toque === 2), "grava em que toque parou");
  assert.ok(updates.some((u) => u.payload.motivo_agendamento === "followup"), "agenda o toque 3");
});

// As duas próximas espelham "registrar_link_enviado não manda o link quando..."
// em tools.test.ts: agendarToque falha fechado pelos mesmos dois motivos
// (nao_perturbe confirmado ou falha ao confirmar), e os dois são tratados
// igual — não dá para distinguir "parou de verdade" de "não sei se parou".
// A diferença aqui é que a mensagem do toque JÁ foi enviada (o turno só
// descobre a recusa depois), então o turno não pode fingir que nada
// aconteceu: marca precisa_atencao para o Pedro ver que a régua ficou órfã,
// e não devolve reagendou (o worker não pode acreditar que o próximo toque
// está agendado quando ele não está).
test("toque seguinte recusado por não-perturbe marca atenção e não reagenda", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: false,
        followup_toque: 1, ciclo_pausado_ate: null,
        // mesma chamada de tabela serve o select inicial do turno (usa só os
        // campos de cima) e o motivoParaRecusarAgendamento de dentro de
        // agendarToque (usa leads.nao_perturbe) — o fake do supabase não
        // distingue as duas consultas por coluna selecionada.
        leads: { nao_perturbe: true },
      },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 2 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "oi", timestamp_ms: AGORA - 2 * 86_400_000 }],
      error: null,
    },
  });
  let enviou = false;

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => ({ texto: "e aí, o que pesou?", toolCalls: [] }),
    enviar: async () => { enviou = true; return { messageid: "WA1" }; },
  });

  assert.equal(enviou, true, "a mensagem do toque já saiu antes de a régua ser checada");
  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, undefined, "não existe agendamento nenhum para o worker preservar");

  const leadAtualizado = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(leadAtualizado?.payload.precisa_atencao, true, "o Pedro precisa saber que a régua ficou órfã");

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead" && c.operacao === "insert");
  assert.equal(evento?.payload.tipo_evento, "escalado");
});

test("toque seguinte recusado por falha ao confirmar opt-out marca atenção e não reagenda", async () => {
  let chamadasConversa = 0;
  const admin = adminDeConversa({
    "conversas.select": () => {
      chamadasConversa++;
      // 1ª chamada: leitura inicial do turno. 2ª chamada: o recheck de
      // pausa desta task, logo antes do envio — as duas têm que ter
      // sucesso para o turno continuar até enviar a mensagem do toque.
      if (chamadasConversa <= 2) {
        return {
          data: {
            id: "C1", lead_id: "L1", pausada_pela_ia: false,
            followup_toque: 1, ciclo_pausado_ate: null,
          },
          error: null,
        };
      }
      // 3ª chamada: motivoParaRecusarAgendamento, dentro de agendarToque —
      // a consulta em si falha (rede, Postgres).
      return { data: null, error: { message: "conexão com o banco caiu" } };
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 2 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "oi", timestamp_ms: AGORA - 2 * 86_400_000 }],
      error: null,
    },
  });
  let enviou = false;

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => ({ texto: "e aí, o que pesou?", toolCalls: [] }),
    enviar: async () => { enviou = true; return { messageid: "WA1" }; },
  });

  assert.equal(enviou, true, "a mensagem do toque já saiu antes de a régua ser checada");
  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, undefined, "não existe agendamento nenhum para o worker preservar");

  const leadAtualizado = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(leadAtualizado?.payload.precisa_atencao, true, "o Pedro precisa saber que a régua ficou órfã");

  const evento = admin.chamadas.find((c) => c.tabela === "eventos_lead" && c.operacao === "insert");
  assert.equal(evento?.payload.tipo_evento, "escalado");
});

test("o 4º toque encerra o ciclo com pausa de 30 dias", async () => {
  const admin = adminDeConversa({
    "conversas.select": {
      data: { id: "C1", lead_id: "L1", pausada_pela_ia: false, followup_toque: 3, ciclo_pausado_ate: null },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "acompanhamento",
        precisa_atencao: false, nao_perturbe: false,
        link_enviado_em: new Date(AGORA - 10 * 86_400_000).toISOString(),
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "ia", tipo: "texto", conteudo: "oi", timestamp_ms: AGORA - 5 * 86_400_000 }],
      error: null,
    },
  });

  const r = await executarTurno(admin, TOQUE, {
    chamar: async () => ({ texto: "fico à disposição!", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
  });

  assert.equal(r.status, "respondeu");
  const pausa = admin.chamadas.find(
    (c) => c.tabela === "conversas" && c.operacao === "update" && c.payload.ciclo_pausado_ate,
  );
  assert.ok(pausa, "depois do 4º toque a pausa é obrigatória");
  const ate = new Date(pausa!.payload.ciclo_pausado_ate).getTime();
  assert.ok(ate >= AGORA + 29 * 86_400_000, "a pausa é de 30 dias");
  assert.equal(r.reagendou, undefined, "não há próximo toque para preservar");
});

test("modelo em laço de tool para no limite de iterações", async () => {
  const admin = adminDeConversa();
  let vezes = 0;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => {
      vezes++;
      return { texto: null, toolCalls: [{ id: `c${vezes}`, nome: "atualizar_lead", argumentos: { nome: "Ana" } }] };
    },
    enviar: async () => ({}),
  });

  assert.ok(vezes <= 4, `chamou ${vezes} vezes — o limite não segurou`);
  assert.equal(r.status, "erro");
});

test("falha da OpenAI vira status erro, não exceção", async () => {
  const admin = adminDeConversa();
  const r = await executarTurno(admin, CTX, {
    chamar: async () => { throw new Error("OpenAI 503"); },
    enviar: async () => ({}),
  });
  assert.equal(r.status, "erro");
  assert.match(r.motivo ?? "", /503/);
});

test("resposta vazia do modelo não envia mensagem em branco", async () => {
  const admin = adminDeConversa();
  let enviou = false;
  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "   ", toolCalls: [] }),
    enviar: async () => { enviou = true; return {}; },
  });
  assert.equal(enviou, false);
  assert.equal(r.status, "erro");
});

// ===================== Fatia 6, Task 3: resgate pré-link =====================
// `agoraMs` fixo via `deps.agoraMs` (novo nesta task) para os testes de janela
// de silêncio ficarem determinísticos — sem isso, o `Date.now()` real do
// momento em que o teste roda decidiria se o toque desloca ou não.

const RESGATE = { ...CTX, motivo: "resgate" as const };

// 15h em São Paulo (fuso fixo -03:00): bem dentro da janela 8h-21h, e o toque
// de 1h (16h SP) também — nenhum deslocamento deveria acontecer.
const AGORA_DIA = Date.parse("2026-08-10T18:00:00.000Z");

// 22h em São Paulo: já está no silêncio, e o toque de 1h (23h SP) continua no
// silêncio — tem que deslocar para as 8h do dia seguinte.
const AGORA_NOITE = Date.parse("2026-08-10T01:00:00.000Z");

function adminDeResgate(sobrescreve: Record<string, any> = {}) {
  return adminDeConversa({
    "conversas.select": {
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: false,
        followup_toque: 0, ciclo_pausado_ate: null, resgate_toque: 0,
      },
      error: null,
    },
    ...sobrescreve,
  });
}

test("lead sem resposta: toque 1 do resgate é agendado ~1h depois, sem cair no silêncio", async () => {
  const admin = adminDeResgate({
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "quero saber da maquininha", timestamp_ms: AGORA_DIA }],
      error: null,
    },
  });

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "Oi! Você usa CPF ou CNPJ?", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
    agoraMs: AGORA_DIA,
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, true, "o resgate acabou de ser agendado — o worker não pode apagar");

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  const agendamento = updates.find((u) => u.payload.motivo_agendamento === "resgate");
  assert.ok(agendamento, "tem que ter agendado o toque 1 do resgate");
  assert.equal(agendamento!.payload.resgate_toque, 1);
  assert.equal(agendamento!.payload.responder_em, "2026-08-10T19:00:00.000Z", "1h depois, sem deslocar");
});

test("toque de resgate que cairia no silêncio (21h-08h) desloca para as 8h, nunca some", async () => {
  const admin = adminDeResgate({
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "quero saber da maquininha", timestamp_ms: AGORA_NOITE }],
      error: null,
    },
  });

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "Oi! Você usa CPF ou CNPJ?", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
    agoraMs: AGORA_NOITE,
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, true);

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  const agendamento = updates.find((u) => u.payload.motivo_agendamento === "resgate");
  assert.ok(agendamento);
  assert.equal(agendamento!.payload.resgate_toque, 1);
  // Sem a janela de silêncio, o toque cairia às 02:00Z (23h SP) — ainda de
  // madrugada. Deslocado, sai só às 8h de São Paulo do dia seguinte.
  assert.equal(agendamento!.payload.responder_em, "2026-08-10T11:00:00.000Z");
});

test("lead com nao_perturbe nunca tem toque de resgate agendado", async () => {
  const admin = adminDeResgate({
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "qualificando",
        precisa_atencao: false, nao_perturbe: true, link_enviado_em: null,
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "quero saber da maquininha", timestamp_ms: AGORA_DIA }],
      error: null,
    },
  });
  let chamouModelo = false;

  const r = await executarTurno(admin, CTX, {
    chamar: async () => { chamouModelo = true; return { texto: "x", toolCalls: [] }; },
    enviar: async () => ({ messageid: "WA1" }),
    agoraMs: AGORA_DIA,
  });

  assert.equal(r.status, "pulado");
  assert.equal(r.motivo, "nao_perturbe");
  assert.equal(chamouModelo, false, "nao_perturbe bloqueia o turno inteiro, antes de qualquer token");

  const agendouResgate = admin.chamadas.some(
    (c) => c.tabela === "conversas" && c.operacao === "update" && "resgate_toque" in (c.payload ?? {}),
  );
  assert.equal(agendouResgate, false);
});

// Espelha o teste de régua oficial "toque seguinte recusado por não-perturbe":
// defesa em profundidade contra a corrida (nao_perturbe vira true DEPOIS que
// decidirTurno já liberou o turno, mas antes do agendamento do resgate).
test("toque de resgate recusado por não-perturbe concorrente marca atenção e não reagenda", async () => {
  const admin = adminDeResgate({
    "conversas.select": {
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: false,
        followup_toque: 0, ciclo_pausado_ate: null, resgate_toque: 0,
        // Mesma chamada de tabela serve o select inicial do turno e o
        // motivoParaRecusarAgendamento de dentro de agendarResgate (usa
        // leads.nao_perturbe) — o fake do supabase não distingue as duas
        // consultas por coluna selecionada.
        leads: { nao_perturbe: true },
      },
      error: null,
    },
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "quero saber da maquininha", timestamp_ms: AGORA_DIA }],
      error: null,
    },
  });

  const r = await executarTurno(admin, CTX, {
    chamar: async () => ({ texto: "Oi! Você usa CPF ou CNPJ?", toolCalls: [] }),
    enviar: async () => ({ messageid: "WA1" }),
    agoraMs: AGORA_DIA,
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, undefined, "não existe agendamento nenhum para o worker preservar");

  const leadAtualizado = admin.chamadas.find((c) => c.tabela === "leads" && c.operacao === "update");
  assert.equal(leadAtualizado?.payload.precisa_atencao, true);
});

test("4º toque de resgate sem resposta encerra — nenhum 5º toque, sem pausa de 30 dias", async () => {
  const admin = adminDeResgate({
    "conversas.select": {
      data: {
        id: "C1", lead_id: "L1", pausada_pela_ia: false,
        followup_toque: 0, ciclo_pausado_ate: null, resgate_toque: 4,
      },
      error: null,
    },
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "qualificando",
        precisa_atencao: false, nao_perturbe: false, link_enviado_em: null,
      },
      error: null,
    },
    // Ordem MAIS NOVO PRIMEIRO — mesma convenção de `listarMensagens`, que
    // inverte o array recebido (o banco real devolve nessa ordem).
    "mensagens.select": {
      data: [
        { remetente: "ia", tipo: "texto", conteudo: "última prova concreta", timestamp_ms: AGORA_DIA - 3_600_000 },
        { remetente: "lead", tipo: "texto", conteudo: "quero saber da maquininha", timestamp_ms: AGORA_DIA - 12 * 3_600_000 },
      ],
      error: null,
    },
  });
  let instrucoes: string[] = [];

  const r = await executarTurno(admin, RESGATE, {
    chamar: async (mensagens: any[]) => {
      instrucoes = mensagens.filter((m: any) => m.role === "system").map((m: any) => m.content);
      return { texto: "Sem pressa, quando quiser é só me chamar aqui.", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
    agoraMs: AGORA_DIA,
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, undefined, "não há 5º toque para preservar");

  const gatilho = instrucoes[instrucoes.length - 1];
  assert.match(gatilho, /toque 4 de 4/);

  const agendouMais = admin.chamadas.some(
    (c) => c.tabela === "conversas" && c.operacao === "update" && "resgate_toque" in (c.payload ?? {}),
  );
  assert.equal(agendouMais, false, "o 4º toque não agenda um 5º — decisão §9, sem pausa de 30 dias");
});

// Item 4 da task: a guarda de evidência de registrar_link_enviado ("ainda não
// respondeu nada") só recusa o link — mas o resgate precisa disparar no MESMO
// turno em que essa recusa acontece, não como um evento desencontrado depois.
test("recusa da guarda de evidência do link agenda o resgate no MESMO turno", async () => {
  const admin = adminDeResgate({
    "leads.select": {
      data: {
        id: "L1", telefone: "5511987654321", estagio: "novo",
        precisa_atencao: false, nao_perturbe: false, link_enviado_em: null,
      },
      error: null,
    },
    // Só a saudação automática do anúncio: `coletarEvidenciaDoLead` conta
    // isso como ZERO respostas do lead (mesmo critério de tools.test.ts), e
    // `ultima.remetente` continua "lead" — decidirTurno libera o turno
    // normalmente.
    "mensagens.select": {
      data: [{ remetente: "lead", tipo: "texto", conteudo: "Olá! Quero adquirir uma máquina da Ton.", timestamp_ms: AGORA_DIA }],
      error: null,
    },
  });
  const chamadas: any[][] = [];

  const r = await executarTurno(admin, CTX, {
    chamar: async (mensagens: any[]) => {
      chamadas.push(mensagens);
      if (chamadas.length === 1) {
        return {
          texto: null,
          toolCalls: [{ id: "c1", nome: "registrar_link_enviado", argumentos: { produto: "catalogo" } }],
        };
      }
      return { texto: "Pra eu te ajudar certinho: é CPF ou CNPJ?", toolCalls: [] };
    },
    enviar: async () => ({ messageid: "WA1" }),
    agoraMs: AGORA_DIA,
  });

  assert.equal(r.status, "respondeu");
  assert.equal(r.reagendou, true, "o resgate foi agendado no mesmo turno que recusou o link");

  const resultadoDaTool = chamadas[1].find((m: any) => m.role === "tool");
  assert.match(resultadoDaTool.content, /ainda não respondeu nada/);

  const updates = admin.chamadas.filter((c) => c.tabela === "conversas" && c.operacao === "update");
  const agendamento = updates.find((u) => u.payload.motivo_agendamento === "resgate");
  assert.ok(agendamento, "a recusa do link e o agendamento do resgate não podem ficar desencontrados");
  assert.equal(agendamento!.payload.resgate_toque, 1);
});
