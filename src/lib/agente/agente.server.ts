// O turno do agente: carrega estado, decide se fala e em que modo, conversa com
// o modelo, executa tools, envia a resposta e — quando é um toque da régua —
// agenda o toque seguinte.
//
// NUNCA lança. Quem chama é o worker, e uma exceção aqui deixaria o lock da
// conversa preso. Toda falha volta como { status: "erro", motivo }.
import { enviarTextoDoCrm, listarMensagens } from "../crm/mensagens.server.ts";
import { marcarPrecisaAtencao, moverEstagio, obterPrimeiraRespostaDoLead } from "../crm/leads.server.ts";
import { agendarResgate, agendarToque, pausarCiclo, registrarToqueEnviado } from "../crm/conversas.server.ts";
import { registrarNaoPerturbe } from "../crm/nao-perturbe.server.ts";
import { planejarProximoToque } from "../crm/regua.ts";
import { planejarProximoResgate } from "../crm/resgate.ts";
import { proximaAberturaSeSilencio } from "../crm/horario-followup.ts";
import { decidirTurno, definirModo, pediuParaParar, recortarHistorico } from "./politica.ts";
import { instrucaoDoResgate, instrucaoDoToque, montarMensagens, montarSystemPrompt } from "./prompt.ts";
import { DEFINICOES_TOOLS, executarTool } from "./tools.ts";

/** Quantas rodadas de tool o modelo pode pedir antes de a gente cortar. */
export const MAX_ITERACOES_TOOL = 3;

const BUCKET_MIDIA = "crm-midia";
const TTL_URL_IMAGEM_SEGUNDOS = 300;

/**
 * Resolve URL assinada para as imagens do histórico que têm `media_path`,
 * para o modelo enxergar de verdade (multimodal) em vez de só o marcador de
 * texto. Best-effort: se o Storage falhar para uma mensagem, ela simplesmente
 * fica sem `mediaUrl` e `montarMensagens` cai de volta no marcador — uma
 * imagem que o modelo não consegue ver nunca pode derrubar o turno inteiro.
 */
async function resolverUrlsDeImagem(admin: any, historico: any[]): Promise<any[]> {
  return Promise.all(
    historico.map(async (m) => {
      if (m.tipo !== "imagem" || !m.media_path) return m;
      try {
        const { data, error } = await admin.storage
          .from(BUCKET_MIDIA)
          .createSignedUrl(m.media_path, TTL_URL_IMAGEM_SEGUNDOS);
        if (error || !data?.signedUrl) return m;
        return { ...m, mediaUrl: data.signedUrl };
      } catch {
        return m;
      }
    }),
  );
}

export type MotivoTurno = "resposta" | "followup" | "resgate";

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
  /** Injetável só para teste: o resgate pré-link precisa de um "agora" fixo
   *  para os testes de janela de silêncio ficarem determinísticos. Em
   *  produção resolve para `Date.now()`. */
  agoraMs?: number;
};

export async function executarTurno(
  admin: any,
  ctx: { conversaId: string; leadId: string; motivo: MotivoTurno },
  deps: DepsTurno = {},
): Promise<ResultadoTurno> {
  try {
    const { data: conversa } = await admin
      .from("conversas")
      .select("id, lead_id, pausada_pela_ia, followup_toque, ciclo_pausado_ate, resgate_toque")
      .eq("id", ctx.conversaId)
      .maybeSingle();
    if (!conversa) return { status: "erro", motivo: "conversa não encontrada" };

    const { data: lead } = await admin.from("leads").select("*").eq("id", ctx.leadId).maybeSingle();
    if (!lead) return { status: "erro", motivo: "lead não encontrado" };

    const historicoBruto = recortarHistorico(await listarMensagens(admin, ctx.conversaId, 60));
    const historico = await resolverUrlsDeImagem(admin, historicoBruto);
    const ultima = historico[historico.length - 1];
    const ultimaDaCasa = [...historico].reverse().find((m: any) => m.remetente !== "lead");
    const agoraMs = deps.agoraMs ?? Date.now();

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
    // Fatia 6, Task 4 (spec §8.1): o modo decide por `compra_confirmada_em`, não
    // mais pelo estágio sozinho — ver o comentário de `definirModo` (politica.ts)
    // sobre o caso real que motivou a troca.
    const modo = definirModo({ compraConfirmadaEm: lead.compra_confirmada_em ?? null });
    // Sub-estado de "venda" (spec §8.1, modo CONFIRMAÇÃO): o link já saiu, mas
    // ninguém confirmou a compra ainda — acompanhar ativamente em vez de sumir
    // ou de assumir que "quero essa" já é venda fechada.
    const confirmacaoPendente = modo === "venda" && Boolean(lead.link_enviado_em);

    const mensagens: any[] = montarMensagens(
      montarSystemPrompt({
        lead: {
          nome: lead.nome,
          estagio: lead.estagio,
          maquina_interesse: lead.maquina_interesse,
        },
        modo,
        confirmacaoPendente,
      }),
      historico as any,
    );

    const toque = Number(conversa.followup_toque ?? 0) + 1;
    // Diferente da régua oficial, `resgate_toque` já é o toque QUE ESTÁ
    // disparando agora (gravado no momento do agendamento por `agendarResgate`,
    // não depois do envio) — ver o comentário lá.
    const toqueResgateAtual = Number(conversa.resgate_toque ?? 0);
    if (ctx.motivo === "followup") {
      // O toque não tem mensagem nova do lead para reagir. Esta instrução é o
      // gatilho do turno — entra como system para o modelo não confundi-la com
      // fala do cliente. O histórico inteiro vai junto: é ele que impede a
      // repetição de argumento.
      mensagens.push({ role: "system", content: instrucaoDoToque(toque) });
    } else if (ctx.motivo === "resgate") {
      mensagens.push({ role: "system", content: instrucaoDoResgate(toqueResgateAtual) });
    }

    // Sinaliza se alguma tool, em qualquer iteração do turno, já escreveu um
    // agendamento no banco (ex.: registrar_link_enviado chamando agendarToque
    // fora de um toque de régua). Sem isso, o worker limpa o que a tool
    // acabou de agendar — ver o achado que motivou este campo.
    let alguemAgendou = false;

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
          if (r.agendou) alguemAgendou = true;
        }

        // Escalou: a conversa passa a ser respondida pelo Pedro pelo inbox. A
        // Mika não dá a última palavra — mandar mais uma mensagem depois de
        // avisar que vai confirmar e voltar só confunde o cliente.
        if (escalou) return { status: "escalou" };

        continue;
      }

      const texto = resposta.texto?.trim();
      if (!texto) return { status: "erro", motivo: "modelo devolveu resposta vazia" };

      // A checagem do início do turno já tem segundos de idade — a chamada ao
      // modelo demora. Se o Pedro assumiu a conversa nesse intervalo, a
      // resposta da IA não pode sair atrás da dele. Sobra a janela entre esta
      // leitura e o POST para a UAZAPI, de milissegundos: aceitável.
      const { data: conversaAgora, error: erroRecheck } = await admin
        .from("conversas")
        .select("pausada_pela_ia")
        .eq("id", ctx.conversaId)
        .maybeSingle();

      // Falhar fechado: sem conseguir ler o estado da pausa, não dá para
      // afirmar que ninguém assumiu a conversa, e enviar seria justamente o
      // atropelo que este recheck existe para impedir. Vai como "erro", não
      // como "pulado", porque o worker dá retry com backoff em erro e
      // simplesmente desiste no pulado — assim uma falha transitória de
      // leitura atrasa a resposta em vez de engoli-la.
      if (erroRecheck) {
        return { status: "erro", motivo: `falha ao reler a pausa: ${erroRecheck.message}` };
      }
      if (conversaAgora?.pausada_pela_ia) {
        return { status: "pulado", motivo: "pausada_durante_o_turno" };
      }

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

      if (ctx.motivo !== "followup") {
        // Fora do caminho de followup, quem agenda de verdade é fecharToque
        // (motivo === "followup"). Mas se uma tool já agendou um toque nesta
        // mesma iteração — ex.: registrar_link_enviado no meio de uma
        // conversa normal —, o agendamento já está escrito no banco e o
        // worker não pode limpá-lo. reagendou:true é o único jeito de avisar
        // o worker disso fora do caminho de followup.
        if (alguemAgendou) return { status: "respondeu", texto, reagendou: true };

        // Cobre "resposta" (turno normal, com ou sem o link recusado pela
        // guarda de evidência de registrar_link_enviado) E "resgate" (o
        // próprio toque de resgate que acabou de sair): nos dois casos, se o
        // turno terminou sem o link ter saído, agenda o PRÓXIMO toque de
        // resgate no mesmo turno — não pode ficar para um evento separado,
        // senão a recusa da guarda de evidência e o agendamento do resgate
        // desencontram.
        const resultadoResgate = await agendarResgateSeNecessario(admin, ctx, conversa, lead, agoraMs);
        return resultadoResgate.reagendou
          ? { status: "respondeu", texto, reagendou: true }
          : { status: "respondeu", texto };
      }

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

/**
 * Agenda o próximo toque do RESGATE pré-link (spec §4), quando o turno que
 * acabou de terminar não resultou em link enviado. Chamada tanto depois de um
 * turno normal ("resposta", incluindo o caso em que a guarda de evidência de
 * registrar_link_enviado recusou o link no mesmo turno) quanto depois do
 * próprio toque de resgate que acabou de sair ("resgate") — nos dois casos, o
 * lead continua sem link, então o resgate continua.
 *
 * Não faz nada (devolve `{}`) quando: o lead já tem link_enviado_em (a régua
 * oficial assume, resgate não se aplica) ou `planejarProximoResgate` diz que
 * o resgate acabou (4º toque já saiu — decisão §9: SEM pausa de 30 dias,
 * diferente da régua oficial).
 */
async function agendarResgateSeNecessario(
  admin: any,
  ctx: { conversaId: string; leadId: string },
  conversa: { resgate_toque?: number | null },
  lead: any,
  agoraMs: number,
): Promise<{ reagendou?: boolean }> {
  if (lead.link_enviado_em) return {};

  const primeiraMensagemEmMs = await obterPrimeiraRespostaDoLead(admin, ctx.leadId);
  const plano = planejarProximoResgate(
    Number(conversa.resgate_toque ?? 0),
    primeiraMensagemEmMs ?? agoraMs,
    agoraMs,
  );
  if (plano.tipo === "encerrado") return {};

  // Mesmo raciocínio de `proximaAberturaSeSilencio` (Task 2): o toque nunca é
  // perdido, só deslocado para as 8h seguintes se cair na janela 21h-08h.
  const quandoIso = new Date(proximaAberturaSeSilencio(Date.parse(plano.quandoIso))).toISOString();

  // agendarResgate falha fechado (nao_perturbe concorrente ou erro ao
  // confirmar) — mesmo tratamento de `fecharToque` para a régua oficial:
  // marca precisa_atencao para o Pedro ver, e NÃO devolve reagendou (não
  // existe agendamento nenhum para o worker preservar).
  const agendamento = await agendarResgate(admin, ctx.conversaId, plano.toque, quandoIso);
  if (!agendamento.agendado) {
    await marcarPrecisaAtencao(
      admin,
      ctx.leadId,
      `toque de resgate não agendado: ${agendamento.motivo}`,
    );
    return {};
  }
  return { reagendou: true };
}

async function carregarChamadorPadrao() {
  const { chamarOpenAI } = await import("./openai.server.ts");
  return (mensagens: any[], tools: unknown[]) => chamarOpenAI(mensagens as any, tools);
}
