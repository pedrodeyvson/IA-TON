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

test("lead convertido conversa em modo pós-venda", async () => {
  const admin = adminDeConversa({
    "leads.select": {
      data: {
        id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "convertido",
        precisa_atencao: false, nao_perturbe: false,
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
      // 1ª chamada: leitura inicial do turno, tem que ter sucesso para o
      // turno continuar até enviar a mensagem do toque.
      if (chamadasConversa === 1) {
        return {
          data: {
            id: "C1", lead_id: "L1", pausada_pela_ia: false,
            followup_toque: 1, ciclo_pausado_ate: null,
          },
          error: null,
        };
      }
      // 2ª chamada: motivoParaRecusarAgendamento, dentro de agendarToque —
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
