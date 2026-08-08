import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decidirTurno, definirModo, pediuParaParar, recortarHistorico,
  JANELA_HISTORICO, MS_ENTRE_TOQUES,
} from "./politica.ts";

const AGORA = Date.parse("2026-08-20T12:00:00.000Z");

const OK = {
  agenteAtivo: true,
  motivo: "resposta" as const,
  pausada: false,
  precisaAtencao: false,
  naoPerturbe: false,
  temTelefone: true,
  ultimoRemetente: "lead",
  toqueAtual: 0,
  cicloPausadoAte: null as string | null,
  ultimaMensagemIaMs: null as number | null,
  agoraMs: AGORA,
};

const TOQUE = { ...OK, motivo: "followup" as const, ultimoRemetente: "ia" };

test("turno normal responde", () => {
  assert.deepEqual(decidirTurno(OK), { responder: true });
});

test("agente desligado por env não responde", () => {
  assert.deepEqual(decidirTurno({ ...OK, agenteAtivo: false }), {
    responder: false, motivo: "agente_desligado",
  });
});

test("opt-out cala o agente nos DOIS motivos, para sempre", () => {
  assert.deepEqual(decidirTurno({ ...OK, naoPerturbe: true }), {
    responder: false, motivo: "nao_perturbe",
  });
  assert.deepEqual(decidirTurno({ ...TOQUE, naoPerturbe: true }), {
    responder: false, motivo: "nao_perturbe",
  });
});

test("conversa assumida pelo Pedro não responde", () => {
  assert.equal(decidirTurno({ ...OK, pausada: true }).responder, false);
  assert.equal(decidirTurno({ ...TOQUE, pausada: true }).responder, false);
});

test("lead já escalado não responde", () => {
  assert.deepEqual(decidirTurno({ ...OK, precisaAtencao: true }), {
    responder: false, motivo: "lead_escalado",
  });
});

test("lead sem telefone não responde (não há para onde enviar)", () => {
  assert.deepEqual(decidirTurno({ ...OK, temTelefone: false }), {
    responder: false, motivo: "lead_sem_telefone",
  });
});

test("resposta cuja última mensagem é da própria IA não acontece", () => {
  assert.deepEqual(decidirTurno({ ...OK, ultimoRemetente: "ia" }), {
    responder: false, motivo: "sem_mensagem_do_lead",
  });
});

test("toque PODE rodar com a última mensagem sendo da IA", () => {
  // É exatamente o caso: mandamos o link e o lead não voltou.
  assert.deepEqual(decidirTurno(TOQUE), { responder: true });
});

// ===================== Fatia 6, Task 3: resgate pré-link =====================

const RESGATE = { ...OK, motivo: "resgate" as const, ultimoRemetente: "ia" };

test("toque de resgate PODE rodar com a última mensagem sendo da IA", () => {
  // Mesmo caso do toque oficial: o toque existe porque o lead NÃO respondeu.
  assert.deepEqual(decidirTurno(RESGATE), { responder: true });
});

test("nao_perturbe interrompe o resgate sempre — invariante que não muda", () => {
  assert.deepEqual(decidirTurno({ ...RESGATE, naoPerturbe: true }), {
    responder: false, motivo: "nao_perturbe",
  });
});

test("resgate não tem teto fixo nem pausa — quem para é planejarProximoResgate, não decidirTurno", () => {
  // Diferente do toque oficial (que bloqueia toqueAtual >= 4): o resgate
  // sempre responde quando chamado. O 4º toque em si RODA normalmente; quem
  // impede um 5º é a régua pura (resgate.ts), não uma trava de contagem
  // aqui — ver a Task 3 (agente.server.ts).
  assert.deepEqual(decidirTurno({ ...RESGATE, toqueAtual: 4 }), { responder: true });
});

test("o ciclo acaba no 4º toque — não existe 5º", () => {
  assert.deepEqual(decidirTurno({ ...TOQUE, toqueAtual: 4 }), {
    responder: false, motivo: "ciclo_encerrado",
  });
});

test("durante a pausa de 30 dias nenhum toque sai", () => {
  assert.deepEqual(
    decidirTurno({ ...TOQUE, toqueAtual: 4, cicloPausadoAte: "2026-09-19T12:00:00.000Z" }),
    { responder: false, motivo: "ciclo_pausado" },
  );
  // Pausa vencida com ciclo ainda em aberto volta a permitir toque.
  assert.deepEqual(
    decidirTurno({ ...TOQUE, toqueAtual: 1, cicloPausadoAte: "2026-08-19T12:00:00.000Z" }),
    { responder: true },
  );
});

test("no máximo um toque por dia (trava contra bug de agendamento)", () => {
  const duasHorasAtras = AGORA - 2 * 3600_000;
  assert.deepEqual(decidirTurno({ ...TOQUE, toqueAtual: 1, ultimaMensagemIaMs: duasHorasAtras }), {
    responder: false, motivo: "toque_recente_demais",
  });

  const ontem = AGORA - MS_ENTRE_TOQUES - 1000;
  assert.deepEqual(
    decidirTurno({ ...TOQUE, toqueAtual: 1, ultimaMensagemIaMs: ontem }),
    { responder: true },
  );
});

test("a trava de 1 por dia não atrapalha a resposta a uma mensagem do lead", () => {
  // O lead escreveu agora; responder 5 minutos depois da IA é normal.
  const cincoMinAtras = AGORA - 5 * 60_000;
  assert.deepEqual(decidirTurno({ ...OK, ultimaMensagemIaMs: cincoMinAtras }), { responder: true });
});

test("modo pós-venda só depois que o lead virou cliente", () => {
  assert.equal(definirModo({ estagio: "convertido" }), "pos_venda");
  assert.equal(definirModo({ estagio: "qualificando" }), "venda");
  assert.equal(definirModo({ estagio: "link_enviado" }), "venda");
  assert.equal(definirModo({ estagio: "" }), "venda");
});

test("pediuParaParar reconhece o pedido de opt-out", () => {
  for (const texto of [
    "para",
    "PARE",
    "para de me mandar mensagem",
    "não quero mais receber nada",
    "nao quero mais mensagens",
    "me tira dessa lista por favor",
    "me remove da lista",
    "não me manda mais mensagem",
    "quero sair da lista",
    "me descadastra",
  ]) {
    assert.equal(pediuParaParar(texto), true, `deveria reconhecer: ${texto}`);
  }
});

test("pediuParaParar não confunde conversa normal com opt-out", () => {
  for (const texto of [
    "não quero mais a T1, quero a T3",
    "para qual conta cai o dinheiro?",
    "me manda o link",
    "parcela em quantas vezes?",
    "vou parar de usar a maquininha do concorrente",
    "",
    null,
  ]) {
    assert.equal(pediuParaParar(texto as any), false, `falso positivo em: ${texto}`);
  }
});

test("recortarHistorico devolve as últimas N mensagens", () => {
  const muitas = Array.from({ length: 100 }, (_, i) => ({ i }));
  const r = recortarHistorico(muitas);
  assert.equal(r.length, JANELA_HISTORICO);
  assert.equal(r[r.length - 1].i, 99, "tem que ficar com as MAIS RECENTES");
});

test("recortarHistorico não mexe em histórico curto", () => {
  const poucas = [{ i: 1 }, { i: 2 }];
  assert.deepEqual(recortarHistorico(poucas), poucas);
});
