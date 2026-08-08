// Loop in-process. Roda dentro do container do EasyPanel — não é cron, não é
// serverless: o processo é persistente e o setInterval sobrevive.
//
// O lock é o próprio UPDATE: marcar processando_em e ver o que voltou. Com um
// container só não há corrida, mas o lock também protege contra dois ticks se
// sobrepondo quando um turno demora mais que o intervalo.
//
// Quem manda no responder_em é o TURNO, não o loop: num toque da régua o agente
// já agenda o próximo antes de devolver, e por isso o loop só solta o lock
// quando o resultado diz `reagendou`.
import { limparAgendamento, registrarFalha, soltarLock } from "../crm/conversas.server.ts";
import { executarTurno } from "../agente/agente.server.ts";
import { ehLockOrfao, MS_LOCK_ORFAO } from "./selecao.ts";

const INTERVALO_MS = 3000;
const LOTE = 5;

export type DepsWorker = {
  turno?: typeof executarTurno;
};

/** Solta locks de turnos que morreram junto com o processo anterior. */
async function liberarOrfaos(admin: any): Promise<void> {
  const limite = new Date(Date.now() - MS_LOCK_ORFAO).toISOString();
  const { data } = await admin
    .from("conversas")
    .select("id, processando_em")
    .lte("processando_em", limite)
    .limit(LOTE);

  for (const conversa of data ?? []) {
    if (!ehLockOrfao(conversa.processando_em, Date.now())) continue;
    await soltarLock(admin, conversa.id);
    console.warn(`[worker] lock órfão liberado na conversa ${conversa.id}`);
  }
}

export async function processarPendentes(admin: any, deps: DepsWorker = {}): Promise<number> {
  await liberarOrfaos(admin);

  const { data: candidatas } = await admin
    .from("conversas")
    .select("id, lead_id, motivo_agendamento, tentativas")
    .lte("responder_em", new Date().toISOString())
    .is("processando_em", null)
    .limit(LOTE);

  const pendentes = candidatas ?? [];
  const rodarTurno = deps.turno ?? executarTurno;
  let processadas = 0;

  for (const conversa of pendentes) {
    // Lock: só segue quem conseguiu marcar. O `.is("processando_em", null)`
    // garante que dois ticks sobrepostos não peguem a mesma conversa.
    const { data: travadas } = await admin
      .from("conversas")
      .update({ processando_em: new Date().toISOString() })
      .eq("id", conversa.id)
      .is("processando_em", null)
      .select("id");

    if (!travadas || travadas.length === 0) continue;

    const resultado = await rodarTurno(admin, {
      conversaId: conversa.id,
      leadId: conversa.lead_id,
      motivo: conversa.motivo_agendamento === "followup" ? "followup" : "resposta",
    });

    if (resultado.status === "erro") {
      await registrarFalha(
        admin,
        conversa.id,
        (conversa.tentativas ?? 0) + 1,
        resultado.motivo ?? "erro",
      );
      console.warn(`[worker] turno falhou na conversa ${conversa.id}: ${resultado.motivo}`);
    } else if (resultado.reagendou) {
      // O turno já deixou o próximo toque marcado: aqui só o lock sai.
      await soltarLock(admin, conversa.id);
    } else {
      if (resultado.status === "pulado") {
        console.log(`[worker] conversa ${conversa.id} pulada: ${resultado.motivo}`);
      }
      await limparAgendamento(admin, conversa.id);
    }

    processadas++;
  }

  return processadas;
}

export function iniciarLoop(admin: any, deps: DepsWorker = {}): { parar: () => void } {
  let rodando = false;

  const temporizador = setInterval(async () => {
    // Um tick lento não pode empilhar outro em cima.
    if (rodando) return;
    rodando = true;
    try {
      await processarPendentes(admin, deps);
    } catch (err: any) {
      // O loop nunca pode morrer: um erro aqui pararia o agente até o próximo
      // deploy, sem ninguém perceber.
      console.error("[worker] erro no tick:", err?.message ?? err);
    } finally {
      rodando = false;
    }
  }, INTERVALO_MS);

  // Não segura o processo vivo por si só.
  if (typeof temporizador.unref === "function") temporizador.unref();

  console.log(`[worker] loop do agente iniciado (tick ${INTERVALO_MS}ms)`);
  return { parar: () => clearInterval(temporizador) };
}
