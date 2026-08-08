// O turno do agente: carrega estado, decide se fala e em que modo, conversa com
// o modelo, executa tools, envia a resposta e — quando é um toque da régua —
// agenda o toque seguinte.
//
// NUNCA lança. Quem chama é o worker, e uma exceção aqui deixaria o lock da
// conversa preso. Toda falha volta como { status: "erro", motivo }.
import { enviarTextoDoCrm, listarMensagens } from "../crm/mensagens.server.ts";
import { marcarPrecisaAtencao, moverEstagio } from "../crm/leads.server.ts";
import { agendarToque, pausarCiclo, registrarToqueEnviado } from "../crm/conversas.server.ts";
import { registrarNaoPerturbe } from "../crm/nao-perturbe.server.ts";
import { planejarProximoToque } from "../crm/regua.ts";
import { decidirTurno, definirModo, pediuParaParar, recortarHistorico } from "./politica.ts";
import { instrucaoDoToque, montarMensagens, montarSystemPrompt } from "./prompt.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";

/** Quantas rodadas de tool o modelo pode pedir antes de a gente cortar. */
export const MAX_ITERACOES_TOOL = 3;

export type MotivoTurno = "resposta" | "followup";

export type ResultadoTurno = {
  status: "respondeu" | "escalou" | "pulado" | "erro";
  motivo?: string;
  texto?: string;
  /** true = o turno já deixou um agendamento novo; o worker não pode limpá-lo. */
  reagendou?: boolean;
};

export type DepsTurno = {
  chamar?: (
    mensagens: any[],
    tools: unknown[],
  ) => Promise<{ texto: string | null; toolCalls: any[] }>;
  enviar?: (numero: string, texto: string) => Promise<any>;
};

export async function executarTurno(
  admin: any,
  ctx: { conversaId: string; leadId: string; motivo: MotivoTurno },
  deps: DepsTurno = {},
): Promise<ResultadoTurno> {
  try {
    const { data: conversa } = await admin
      .from("conversas")
      .select("id, lead_id, pausada_pela_ia, followup_toque, ciclo_pausado_ate")
      .eq("id", ctx.conversaId)
      .maybeSingle();
    if (!conversa) return { status: "erro", motivo: "conversa não encontrada" };

    const { data: lead } = await admin.from("leads").select("*").eq("id", ctx.leadId).maybeSingle();
    if (!lead) return { status: "erro", motivo: "lead não encontrado" };

    const historico = recortarHistorico(await listarMensagens(admin, ctx.conversaId, 60));
    const ultima = historico[historico.length - 1];
    const ultimaDaCasa = [...historico].reverse().find((m: any) => m.remetente !== "lead");
    const agoraMs = Date.now();

    const decisao = decidirTurno({
      agenteAtivo: process.env.AGENTE_ATIVO !== "false",
      motivo: ctx.motivo,
      pausada: Boolean(conversa.pausada_pela_ia),
      precisaAtencao: Boolean(lead.precisa_atencao),
      naoPerturbe: Boolean(lead.nao_perturbe),
      temTelefone: Boolean(lead.telefone),
      ultimoRemetente: (ultima as any)?.remetente ?? "",
      toqueAtual: Number(conversa.followup_toque ?? 0),
      cicloPausadoAte: conversa.ciclo_pausado_ate ?? null,
      ultimaMensagemIaMs: (ultimaDaCasa as any)?.timestamp_ms ?? null,
      agoraMs,
    });
    if (!decisao.responder) return { status: "pulado", motivo: decisao.motivo };

    // Opt-out antes de qualquer token: pedir para parar é o único caso em que
    // errar custa o relacionamento inteiro, então não depende do modelo.
    if (ctx.motivo === "resposta" && pediuParaParar((ultima as any)?.conteudo)) {
      await registrarNaoPerturbe(admin, {
        leadId: ctx.leadId,
        conversaId: ctx.conversaId,
        motivo: "o lead pediu para parar de receber mensagens",
      });
      return { status: "escalou", motivo: "opt_out" };
    }

    const chamar = deps.chamar ?? (await carregarChamadorPadrao());
    const modo = definirModo({ estagio: String(lead.estagio ?? "") });

    const mensagens: any[] = montarMensagens(
      montarSystemPrompt({
        lead: {
          nome: lead.nome,
          estagio: lead.estagio,
          maquina_interesse: lead.maquina_interesse,
        },
        modo,
      }),
      historico as any,
    );

    const toque = Number(conversa.followup_toque ?? 0) + 1;
    if (ctx.motivo === "followup") {
      // O toque não tem mensagem nova do lead para reagir. Esta instrução é o
      // gatilho do turno — entra como system para o modelo não confundi-la com
      // fala do cliente. O histórico inteiro vai junto: é ele que impede a
      // repetição de argumento.
      mensagens.push({ role: "system", content: instrucaoDoToque(toque) });
    }

    for (let iteracao = 0; iteracao <= MAX_ITERACOES_TOOL; iteracao++) {
      const resposta = await chamar(mensagens, DEFINICOES_TOOLS);

      if (resposta.toolCalls?.length) {
        mensagens.push({
          role: "assistant",
          content: resposta.texto ?? null,
          tool_calls: resposta.toolCalls.map((t: any) => ({
            id: t.id,
            type: "function",
            function: { name: t.nome, arguments: JSON.stringify(t.argumentos) },
          })),
        });

        let escalou = false;
        for (const chamada of resposta.toolCalls) {
          const r = await executarTool(admin, chamada.nome, chamada.argumentos, {
            leadId: ctx.leadId,
            conversaId: ctx.conversaId,
          });
          mensagens.push({ role: "tool", tool_call_id: chamada.id, content: r.conteudo });
          if (r.escalou) escalou = true;
        }

        // Escalou: a conversa passa a ser respondida pelo Pedro pelo inbox. A
        // Mika não dá a última palavra — mandar mais uma mensagem depois de
        // avisar que vai confirmar e voltar só confunde o cliente.
        if (escalou) return { status: "escalou" };

        continue;
      }

      const texto = resposta.texto?.trim();
      if (!texto) return { status: "erro", motivo: "modelo devolveu resposta vazia" };

      const envio = await enviarTextoDoCrm(
        admin,
        {
          conversaId: ctx.conversaId,
          leadId: ctx.leadId,
          telefone: lead.telefone,
          texto,
          remetente: "ia",
        },
        deps.enviar ? { enviar: deps.enviar } : {},
      );
      if (!envio.ok) return { status: "erro", motivo: envio.erro };

      if (ctx.motivo !== "followup") return { status: "respondeu", texto };

      return { ...(await fecharToque(admin, ctx, lead, toque, agoraMs)), texto };
    }

    // Estourou o limite: o modelo ficou pedindo tool sem nunca redigir a
    // resposta. Melhor falhar visivelmente do que insistir gastando token.
    return { status: "erro", motivo: "modelo excedeu o limite de iterações de tool" };
  } catch (err: any) {
    return { status: "erro", motivo: err?.message ?? "falha desconhecida no turno" };
  }
}

/**
 * Fecha um toque: registra em que ponto do ciclo ele parou e planeja o que vem
 * depois — o próximo toque, ou a pausa obrigatória de 30 dias.
 */
async function fecharToque(
  admin: any,
  ctx: { conversaId: string; leadId: string },
  lead: any,
  toque: number,
  agoraMs: number,
): Promise<ResultadoTurno> {
  await registrarToqueEnviado(admin, ctx.conversaId, toque);

  // O primeiro toque é o que tira o lead de "link_enviado": daqui em diante ele
  // está em acompanhamento, e é assim que o funil da Fatia 4 vai mostrar.
  if (toque === 1) await moverEstagio(admin, ctx.leadId, "acompanhamento", { origem: "agente" });

  const plano = planejarProximoToque(toque, Date.parse(lead.link_enviado_em ?? ""), agoraMs);

  if (plano.tipo === "toque") {
    // agendarToque falha fechado (opt-out concorrente ou erro ao confirmar
    // que não está) — o retorno não pode ser ignorado. Se ele recusar, não
    // existe agendamento nenhum para o worker preservar: devolver
    // reagendou:true aqui faria o worker acreditar que a régua já está
    // cuidada e pular a própria limpeza, deixando a conversa sem
    // responder_em e sem chance de retomar o ciclo depois. Sem reagendou, o
    // caminho padrão do worker é chamar limparAgendamento — que apaga
    // ativamente responder_em/motivo_agendamento/processando_em. Isso
    // deixaria a régua órfã em silêncio: nada além de uma nova mensagem do
    // próprio lead reabriria o fluxo. Por isso marcamos precisa_atencao,
    // espelhando o mesmo par de motivos (nao_perturbe e
    // erro_ao_verificar_optout) tratado igual em executarRegistrarLink
    // (tools.ts) — não dá para distinguir "parou de verdade" de "não sei se
    // parou", então os dois pedem os olhos do Pedro. Não pausamos a IA
    // aqui: a mensagem deste toque já foi enviada, não há risco imediato de
    // nova mensagem indevida — o que falta é só visibilidade.
    const agendamento = await agendarToque(admin, ctx.conversaId, plano.quandoIso);
    if (!agendamento.agendado) {
      await marcarPrecisaAtencao(
        admin,
        ctx.leadId,
        `toque seguinte não agendado: ${agendamento.motivo}`,
      );
      return {
        status: "respondeu",
        motivo: `toque seguinte não agendado: ${agendamento.motivo}`,
      };
    }
    return { status: "respondeu", reagendou: true };
  }

  await pausarCiclo(admin, ctx.conversaId, plano.ateIso);
  return { status: "respondeu" };
}

async function carregarChamadorPadrao() {
  const { chamarOpenAI } = await import("./openai.server.ts");
  return (mensagens: any[], tools: unknown[]) => chamarOpenAI(mensagens as any, tools);
}
