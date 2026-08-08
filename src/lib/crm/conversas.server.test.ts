import { test } from "node:test";
import assert from "node:assert/strict";
import { criarAdminFake } from "./admin-fake.ts";
import {
  agendarResgate, agendarResposta, agendarToque, limparAgendamento, soltarLock, registrarFalha,
  registrarToqueEnviado, pausarCiclo, reiniciarCiclo, pausarIa, retomarIa,
  marcarLida, MS_POR_TENTATIVA,
  registrarFalhaDeEnvio, zerarFalhasDestinatario, MAX_FALHAS_DESTINATARIO,
} from "./conversas.server.ts";

function payloadUpdate(admin: any) {
  return admin.chamadas.find((c: any) => c.operacao === "update")?.payload;
}

test("agendarResposta grava responder_em no futuro com motivo resposta", async () => {
  const admin = criarAdminFake();
  const agora = Date.parse("2026-08-07T10:00:00.000Z");
  const resultado = await agendarResposta(admin, "C1", 8000, agora);

  assert.equal(resultado.agendado, true);
  const p = payloadUpdate(admin);
  assert.equal(p.motivo_agendamento, "resposta");
  assert.equal(p.responder_em, "2026-08-07T10:00:08.000Z");
  // Mensagem nova reabre o crédito de tentativas.
  assert.equal(p.tentativas, 0);
  assert.equal(p.ultimo_erro, null);
});

test("agendarResposta não agenda quando o lead está em nao_perturbe", async () => {
  const admin = criarAdminFake({
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: true } }, error: null },
  });
  const resultado = await agendarResposta(admin, "C1", 8000);

  assert.deepEqual(resultado, { agendado: false, motivo: "nao_perturbe" });
  assert.equal(payloadUpdate(admin), undefined, "nenhum update pode escrever responder_em");
});

test("agendarResposta agenda normalmente quando o lead não optou por não perturbe", async () => {
  const admin = criarAdminFake({
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: false } }, error: null },
  });
  const resultado = await agendarResposta(admin, "C1", 8000);

  assert.equal(resultado.agendado, true);
  assert.ok(payloadUpdate(admin), "deve escrever o agendamento normalmente");
});

test("agendarToque grava o instante exato calculado pela régua", async () => {
  const admin = criarAdminFake();
  const quando = "2026-08-10T12:00:00.000Z";
  const resultado = await agendarToque(admin, "C1", quando);

  assert.equal(resultado.agendado, true);
  const p = payloadUpdate(admin);
  assert.equal(p.responder_em, quando);
  assert.equal(p.motivo_agendamento, "followup");
  assert.equal(p.tentativas, 0);
});

test("agendarToque não agenda quando o lead está em nao_perturbe", async () => {
  const admin = criarAdminFake({
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: true } }, error: null },
  });
  const resultado = await agendarToque(admin, "C1", "2026-08-10T12:00:00.000Z");

  assert.deepEqual(resultado, { agendado: false, motivo: "nao_perturbe" });
  assert.equal(payloadUpdate(admin), undefined, "nenhum toque pode ser escrito para quem optou por sair");
});

test("agendarResposta falha fechada: erro ao checar opt-out também recusa agendar", async () => {
  const admin = criarAdminFake({
    "conversas.select": () => ({ data: null, error: { message: "conexão com o banco caiu" } }),
  });
  const resultado = await agendarResposta(admin, "C1", 8000);

  assert.deepEqual(resultado, { agendado: false, motivo: "erro_ao_verificar_optout" });
  assert.equal(payloadUpdate(admin), undefined, "erro na checagem não pode liberar o agendamento");
});

test("agendarToque falha fechada: erro ao checar opt-out também recusa agendar", async () => {
  const admin = criarAdminFake({
    "conversas.select": () => ({ data: null, error: { message: "conexão com o banco caiu" } }),
  });
  const resultado = await agendarToque(admin, "C1", "2026-08-10T12:00:00.000Z");

  assert.deepEqual(resultado, { agendado: false, motivo: "erro_ao_verificar_optout" });
  assert.equal(payloadUpdate(admin), undefined, "erro na checagem não pode liberar o toque");
});

// ===================== Fatia 6, Task 3: resgate pré-link =====================

test("agendarResgate grava resgate_toque, responder_em e motivo_agendamento=resgate", async () => {
  const admin = criarAdminFake();
  const quando = "2026-08-10T19:00:00.000Z";
  const resultado = await agendarResgate(admin, "C1", 1, quando);

  assert.equal(resultado.agendado, true);
  const p = payloadUpdate(admin);
  assert.equal(p.resgate_toque, 1);
  assert.equal(p.responder_em, quando);
  assert.equal(p.motivo_agendamento, "resgate");
  assert.equal(p.tentativas, 0);
  assert.equal(p.ultimo_erro, null);
});

test("agendarResgate não escreve em followup_toque — contador é PRÓPRIO", async () => {
  // Regra explícita da spec §4: reusar followup_toque esgotaria a régua
  // oficial antes dela sequer começar (ela tem `check between 0 and 4`).
  const admin = criarAdminFake();
  await agendarResgate(admin, "C1", 2, "2026-08-10T22:00:00.000Z");
  const p = payloadUpdate(admin);
  assert.equal("followup_toque" in p, false);
});

test("agendarResgate não agenda quando o lead está em nao_perturbe", async () => {
  const admin = criarAdminFake({
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: true } }, error: null },
  });
  const resultado = await agendarResgate(admin, "C1", 1, "2026-08-10T19:00:00.000Z");

  assert.deepEqual(resultado, { agendado: false, motivo: "nao_perturbe" });
  assert.equal(payloadUpdate(admin), undefined, "nenhum toque de resgate pode ser escrito para quem optou por sair");
});

test("agendarResgate falha fechada: erro ao checar opt-out também recusa agendar", async () => {
  const admin = criarAdminFake({
    "conversas.select": () => ({ data: null, error: { message: "conexão com o banco caiu" } }),
  });
  const resultado = await agendarResgate(admin, "C1", 1, "2026-08-10T19:00:00.000Z");

  assert.deepEqual(resultado, { agendado: false, motivo: "erro_ao_verificar_optout" });
  assert.equal(payloadUpdate(admin), undefined, "erro na checagem não pode liberar o toque de resgate");
});

// ===== Regressão do incidente de 08/08/2026 (rajada de 17 mensagens) =====
// O supabase-js resolve com `{ data, error }` em vez de rejeitar. Ignorar o
// `error` do UPDATE fazia estas funções MENTIREM que agendaram: o turno
// devolvia `reagendou: true`, o worker preservava um `responder_em` já
// vencido, e a mesma conversa voltava na varredura a cada 3 segundos. A causa
// concreta foi o check de `motivo_agendamento` não conhecer 'resgate'
// (migration 20260809d), mas o buraco vale para qualquer recusa do banco.

function adminQueRecusaOUpdate() {
  return criarAdminFake({
    "conversas.update": () => ({
      data: null,
      error: { message: 'new row violates check constraint "conversas_motivo_agendamento_check"' },
    }),
  });
}

test("agendarResgate NÃO diz que agendou quando o banco recusa o UPDATE", async () => {
  const resultado = await agendarResgate(
    adminQueRecusaOUpdate(), "C1", 1, "2026-08-10T19:00:00.000Z",
  );
  assert.deepEqual(resultado, { agendado: false, motivo: "erro_ao_agendar" });
});

test("agendarToque NÃO diz que agendou quando o banco recusa o UPDATE", async () => {
  const resultado = await agendarToque(adminQueRecusaOUpdate(), "C1", "2026-08-10T12:00:00.000Z");
  assert.deepEqual(resultado, { agendado: false, motivo: "erro_ao_agendar" });
});

test("agendarResposta NÃO diz que agendou quando o banco recusa o UPDATE", async () => {
  const resultado = await agendarResposta(adminQueRecusaOUpdate(), "C1", 8000);
  assert.deepEqual(resultado, { agendado: false, motivo: "erro_ao_agendar" });
});

// Prova o caso "lead responde antes do toque agendado": agendarResposta não
// olha para o motivo_agendamento atual da conversa, só sobrescreve — é assim
// que uma resposta nova cancela um resgate pendente sem nenhum código
// especial de cancelamento. O worker nunca mais vê motivo_agendamento
// "resgate" para esta conversa depois disso; quem roda é o turno normal
// disparado pela resposta do lead, não o toque de resgate que ficou órfão.
test("agendarResposta sobrescreve um toque de resgate pendente quando o lead responde antes", async () => {
  const admin = criarAdminFake({
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: false } }, error: null },
  });
  const agora = Date.parse("2026-08-10T18:30:00.000Z");
  const resultado = await agendarResposta(admin, "C1", 8000, agora);

  assert.equal(resultado.agendado, true);
  const p = payloadUpdate(admin);
  assert.equal(p.motivo_agendamento, "resposta", "o resgate agendado antes deixa de valer");
  assert.equal(p.responder_em, "2026-08-10T18:30:08.000Z");
});

test("registrarToqueEnviado guarda em que toque o ciclo está", async () => {
  const admin = criarAdminFake();
  await registrarToqueEnviado(admin, "C1", 3);
  const p = payloadUpdate(admin);
  assert.equal(p.followup_toque, 3);
  // A coluna antiga vira "algum toque já saiu neste ciclo".
  assert.equal(p.followup_enviado, true);
});

test("registrarToqueEnviado recusa toque fora de 1..4", async () => {
  const admin = criarAdminFake();
  await assert.rejects(() => registrarToqueEnviado(admin, "C1", 5), /toque/i);
  assert.equal(admin.chamadas.length, 0, "não pode encostar no banco com valor inválido");
});

test("pausarCiclo grava a data e desliga o agendamento", async () => {
  const admin = criarAdminFake();
  await pausarCiclo(admin, "C1", "2026-09-07T12:00:00.000Z");
  const p = payloadUpdate(admin);
  assert.equal(p.ciclo_pausado_ate, "2026-09-07T12:00:00.000Z");
  assert.equal(p.responder_em, null);
  assert.equal(p.processando_em, null);
});

test("reiniciarCiclo zera toque e pausa para um novo ciclo", async () => {
  const admin = criarAdminFake();
  await reiniciarCiclo(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.followup_toque, 0);
  assert.equal(p.followup_enviado, false);
  assert.equal(p.ciclo_pausado_ate, null);
});

test("reiniciarCiclo também zera o resgate — link novo encerra o resgate pré-link", async () => {
  // Sem isso, um resgate no meio da cadência (ex.: toque 2 já agendado)
  // sobreviveria ao link e poderia disparar depois, com o lead já em
  // acompanhamento pela régua oficial.
  const admin = criarAdminFake();
  await reiniciarCiclo(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.resgate_toque, 0);
  assert.equal(p.resgate_pausado_ate, null);
});

test("limparAgendamento zera responder_em, motivo e lock", async () => {
  const admin = criarAdminFake();
  await limparAgendamento(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.responder_em, null);
  assert.equal(p.motivo_agendamento, null);
  assert.equal(p.processando_em, null);
});

test("soltarLock preserva o agendamento que o turno acabou de fazer", async () => {
  const admin = criarAdminFake();
  await soltarLock(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.processando_em, null);
  assert.equal("responder_em" in p, false, "o próximo toque não pode ser apagado aqui");
});

test("registrarFalha aplica backoff exponencial e solta o lock", async () => {
  const admin = criarAdminFake();
  const agora = Date.parse("2026-08-07T10:00:00.000Z");
  await registrarFalha(admin, "C1", 2, "openai 503", agora);

  const p = payloadUpdate(admin);
  assert.equal(p.tentativas, 2);
  assert.equal(p.ultimo_erro, "openai 503");
  assert.equal(p.processando_em, null);
  assert.equal(
    p.responder_em,
    new Date(agora + MS_POR_TENTATIVA * 4).toISOString(),
    "tentativas=2 -> 2^2 * 30s = 120s de backoff",
  );
});

test("registrarFalha na 3ª tentativa desiste em vez de reagendar", async () => {
  const admin = criarAdminFake();
  await registrarFalha(admin, "C1", 3, "openai 503");
  assert.equal(payloadUpdate(admin).responder_em, null, "na 3ª quem assume é o Pedro");
});

test("pausarIa liga a flag e carimba assumida_em", async () => {
  const admin = criarAdminFake();
  await pausarIa(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.pausada_pela_ia, true);
  assert.ok(p.assumida_em);
});

test("retomarIa desliga a flag e limpa assumida_em", async () => {
  const admin = criarAdminFake();
  await retomarIa(admin, "C1");
  const p = payloadUpdate(admin);
  assert.equal(p.pausada_pela_ia, false);
  assert.equal(p.assumida_em, null);
});

// ===================== Fatia 6, Task 6: falha do destinatário =====================

/** Fake com estado: simula `falhas_destinatario` persistindo entre chamadas
 *  (o admin-fake genérico não guarda estado — cada resposta configurada é
 *  estática), para testar a sequência de 3 falhas consecutivas de verdade. */
function criarAdminComContadorDeFalhas() {
  const estado = { falhas: 0 };
  const leadUpdates: any[] = [];
  const conversaUpdatesDeLimpeza: any[] = [];
  const admin = criarAdminFake({
    "conversas.select": () => ({ data: { falhas_destinatario: estado.falhas }, error: null }),
    "conversas.update": (c: any) => {
      if (c.payload && "falhas_destinatario" in c.payload) estado.falhas = c.payload.falhas_destinatario;
      if (c.payload && "responder_em" in c.payload) conversaUpdatesDeLimpeza.push(c.payload);
      return { data: null, error: null };
    },
    "leads.update": (c: any) => { leadUpdates.push(c.payload); return { data: null, error: null }; },
  });
  return { admin, estado, leadUpdates, conversaUpdatesDeLimpeza };
}

test("3 falhas de destinatário seguidas incrementam até o teto e param o envio", async () => {
  const { admin, estado, leadUpdates, conversaUpdatesDeLimpeza } = criarAdminComContadorDeFalhas();

  await registrarFalhaDeEnvio(admin, "C1", "L1", true);
  assert.equal(estado.falhas, 1);
  assert.equal(leadUpdates.length, 0, "antes do teto, nada muda em leads");

  await registrarFalhaDeEnvio(admin, "C1", "L1", true);
  assert.equal(estado.falhas, 2);
  assert.equal(leadUpdates.length, 0);

  await registrarFalhaDeEnvio(admin, "C1", "L1", true);
  assert.equal(estado.falhas, MAX_FALHAS_DESTINATARIO);
  // Na 3ª: marca bloqueio_suspeito (não nao_perturbe — causa é diferente) e
  // avisa o Pedro.
  assert.equal(leadUpdates.length, 1);
  assert.equal(leadUpdates[0].bloqueio_suspeito, true);
  assert.equal(leadUpdates[0].precisa_atencao, true);
  // E a conversa some da fila agora mesmo — mesmo mecanismo de limparAgendamento.
  assert.equal(conversaUpdatesDeLimpeza.length, 1);
  assert.equal(conversaUpdatesDeLimpeza[0].responder_em, null);
});

test("depois do bloqueio_suspeito, motivoParaRecusarAgendamento (via agendarResposta) recusa agendar", async () => {
  // Prova que a conversa realmente some da fila de reprocessamento: o mesmo
  // portão que nao_perturbe usa também passa a recusar por bloqueio_suspeito.
  const admin = criarAdminFake({
    "conversas.select": { data: { id: "C1", leads: { nao_perturbe: false, bloqueio_suspeito: true } }, error: null },
  });
  const resultado = await agendarResposta(admin, "C1", 8000);
  assert.deepEqual(resultado, { agendado: false, motivo: "bloqueio_suspeito" });
});

test("1 falha de destinatário + 1 envio bem-sucedido NÃO acumula — zera", async () => {
  const { admin, estado } = criarAdminComContadorDeFalhas();

  await registrarFalhaDeEnvio(admin, "C1", "L1", true);
  assert.equal(estado.falhas, 1);

  await zerarFalhasDestinatario(admin, "C1");
  assert.equal(estado.falhas, 0);
});

test("falha transitória nunca conta para falhas_destinatario — nem toca no banco", async () => {
  const admin = criarAdminFake();
  await registrarFalhaDeEnvio(admin, "C1", "L1", false);
  assert.equal(admin.chamadas.length, 0, "falha transitória é domínio exclusivo de registrarFalha/tentativas");
});

test("marcarLida zera o contador de não lidas do lead", async () => {
  const admin = criarAdminFake();
  await marcarLida(admin, "L1");
  const chamada = admin.chamadas.find((c: any) => c.tabela === "leads");
  assert.equal(chamada.payload.nao_lidas, 0);
  assert.deepEqual(chamada.filtros, [["id", "L1"]]);
});

// ===================== Fatia 5, Task 6: foto e tags derivadas =====================

test("listarConversas devolve as colunas de perfil e atribuição do lead", async () => {
  const admin = criarAdminFake({
    "leads.select": {
      data: [
        {
          id: "L1", nome: "Ana", telefone: "5511987654321", estagio: "qualificando",
          foto_path: "L1.jpg", maquina_interesse: "T3 Smart", origem: "anuncio", ad_title: "Campanha Agosto",
          conversas: { id: "C1", pausada_pela_ia: false },
        },
      ],
      error: null,
    },
  });
  const { listarConversas } = await import("./conversas.server.ts");
  const r = await listarConversas(admin, 50);
  assert.equal(r.length, 1);
  assert.equal(r[0].foto_path, "L1.jpg");
  assert.equal(r[0].maquina_interesse, "T3 Smart");
  assert.equal(r[0].origem, "anuncio");
  assert.equal(r[0].ad_title, "Campanha Agosto");
});
