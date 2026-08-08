// Definição e execução das tools. `executarTool` NUNCA lança: toda falha volta
// como texto para o modelo, que pode se corrigir no mesmo turno. Uma exceção
// aqui mataria a resposta ao cliente por causa de um argumento mal formado.
import { ehEstagio } from "../crm/estagios.ts";
import { atualizarLead, marcarPrecisaAtencao, moverEstagio } from "../crm/leads.server.ts";
import {
  agendarToque, limparAgendamento, pausarIa, reiniciarCiclo,
} from "../crm/conversas.server.ts";
import { registrarNaoPerturbe } from "../crm/nao-perturbe.server.ts";
import { planejarProximoToque } from "../crm/regua.ts";
import { ALVOS_DE_LINK, montarLink, PRODUTOS } from "./links.ts";

const RESULTADOS = ["comprou", "nao_comprou", "nao_perturbe"] as const;
type ResultadoCompra = (typeof RESULTADOS)[number];

export const DEFINICOES_TOOLS = [
  {
    type: "function",
    function: {
      name: "atualizar_lead",
      description:
        "Grava o que você descobriu sobre o cliente: o nome dele, qual máquina interessa, e o " +
        "estágio do funil em que a conversa está. Chame assim que souber algo novo.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome do cliente, como ele se apresentou" },
          maquina_interesse: {
            type: "string",
            description: "Nível ou modelo que interessa (ex.: T3 Smart, TapTon)",
          },
          estagio: {
            type: "string",
            enum: ["qualificando", "apresentando_solucao", "contornando_objecao", "acompanhamento"],
            description: "Estágio atual da conversa",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_link_enviado",
      description:
        "Escolha o produto e receba o link pronto para colar na resposta. Use 'catalogo' quando " +
        "o cliente ainda não decidiu a máquina, e o productId do modelo quando ele já decidiu — " +
        "o checkout cai direto no carrinho. Você nunca escreve endereço: só escolhe o produto.",
      parameters: {
        type: "object",
        properties: {
          produto: {
            type: "string",
            enum: [...ALVOS_DE_LINK],
            description: "O produto do checkout, ou 'catalogo' para o cliente escolher",
          },
        },
        required: ["produto"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "registrar_resultado_compra",
      description:
        "Registre o que o cliente disse sobre a compra. 'comprou' libera o acompanhamento de " +
        "pós-venda; 'nao_comprou' guarda o motivo e você quebra a objeção na mesma resposta; " +
        "'nao_perturbe' quando ele pediu para não receber mais mensagens.",
      parameters: {
        type: "object",
        properties: {
          resultado: { type: "string", enum: [...RESULTADOS] },
          detalhe: {
            type: "string",
            description: "O que ele disse, nas palavras dele (motivo, objeção, pedido)",
          },
        },
        required: ["resultado"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalar_para_humano",
      description:
        "Passa a conversa para o Pedro e encerra o seu turno. Use para negociação especial de " +
        "taxa, faixa que não está na sua tabela, cliente irritado, pedido para falar com uma " +
        "pessoa, e para problema de pós-venda que você tentou resolver e não resolveu.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", description: "Por que está escalando" } },
        required: ["motivo"],
        additionalProperties: false,
      },
    },
  },
];

export type ResultadoTool = {
  /** Volta para o modelo como conteúdo da mensagem role:"tool". */
  conteudo: string;
  /** true encerra o turno: o agente não responde mais nada. */
  escalou?: boolean;
};

export type ContextoTool = { leadId: string; conversaId: string };

async function registrarEvento(
  admin: any,
  leadId: string,
  tipoEvento: string,
  detalhe: Record<string, unknown>,
): Promise<void> {
  await admin
    .from("eventos_lead")
    .insert({ lead_id: leadId, tipo_evento: tipoEvento, detalhe });
}

export async function executarTool(
  admin: any,
  nome: string,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  try {
    switch (nome) {
      case "atualizar_lead":
        return await executarAtualizarLead(admin, argumentos, ctx);
      case "registrar_link_enviado":
        return await executarRegistrarLink(admin, argumentos, ctx);
      case "registrar_resultado_compra":
        return await executarResultadoCompra(admin, argumentos, ctx);
      case "escalar_para_humano":
        return await executarEscalar(admin, argumentos, ctx);
      default:
        return { conteudo: `Erro: tool desconhecida "${nome}".` };
    }
  } catch (err: any) {
    // Devolve o erro ao modelo em vez de derrubar o turno.
    return { conteudo: `Erro ao executar ${nome}: ${err?.message ?? "falha desconhecida"}` };
  }
}

async function executarAtualizarLead(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const estagio = argumentos.estagio;
  if (estagio !== undefined && !ehEstagio(estagio)) {
    return { conteudo: `Erro: estágio "${String(estagio)}" é inválido. Nada foi gravado.` };
  }

  const nome = typeof argumentos.nome === "string" ? argumentos.nome.trim() : undefined;
  const maquina =
    typeof argumentos.maquina_interesse === "string"
      ? argumentos.maquina_interesse.trim()
      : undefined;

  await atualizarLead(admin, ctx.leadId, {
    nome: nome || undefined,
    maquina_interesse: maquina || undefined,
  });

  if (estagio !== undefined) await moverEstagio(admin, ctx.leadId, estagio, { origem: "agente" });

  return { conteudo: "ok, lead atualizado" };
}

async function executarRegistrarLink(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const link = montarLink(argumentos.produto);

  if (!link.ok && link.erro === "produto_desconhecido") {
    // Erro do modelo, não do sistema: devolve a lista e deixa ele tentar de novo
    // no mesmo turno, sem sujar o lead.
    return {
      conteudo:
        `Erro: produto "${String(argumentos.produto)}" não existe. ` +
        `Escolha um destes: ${ALVOS_DE_LINK.join(", ")}.`,
    };
  }

  if (!link.ok) {
    // Sem referrer o link não atribui a indicação ao Pedro: a venda acontece e
    // ele não ganha. Melhor não mandar nada e chamar o dono.
    await marcarPrecisaAtencao(admin, ctx.leadId, "TON_REFERRER não configurado");
    await pausarIa(admin, ctx.conversaId);
    return {
      conteudo: "Erro: o link de indicação não está configurado. A conversa foi passada para o Pedro.",
      escalou: true,
    };
  }

  const produto = argumentos.produto as keyof typeof PRODUTOS | "catalogo";
  const rotulo = produto === "catalogo" ? "catálogo" : (PRODUTOS[produto].nome ?? produto);

  // Confere ANTES de mexer no lead ou na conversa se dá para agendar o
  // próximo toque. agendarToque devolve um resultado (proteção de opt-out do
  // Task 5) — não pode ser ignorado. Se recusar (lead em não-perturbe, ou
  // falha ao confirmar que não está), é opt-out real: espelha exatamente o
  // branch `nao_perturbe` de executarResultadoCompra — não manda o link, não
  // move o estágio, escala de verdade. Uma mensagem comercial não pode sair
  // "com aviso" para quem pediu para parar; os dois motivos de recusa
  // (nao_perturbe confirmado ou falha ao confirmar) são tratados igual, por
  // segurança — não dá para distinguir "parou" de "não sei se parou".
  const agora = Date.now();
  const plano = planejarProximoToque(0, agora, agora);
  if (plano.tipo === "toque") {
    const agendamento = await agendarToque(admin, ctx.conversaId, plano.quandoIso);
    if (!agendamento.agendado) {
      await marcarPrecisaAtencao(
        admin,
        ctx.leadId,
        `Link não enviado: agendamento do toque recusado (${agendamento.motivo}).`,
      );
      await pausarIa(admin, ctx.conversaId);
      return {
        conteudo:
          "Erro: não é seguro enviar o link para este lead agora (checagem de não-perturbe " +
          "recusou o agendamento do toque). Nada foi enviado. A conversa foi passada para o Pedro.",
        escalou: true,
      };
    }
  }

  await moverEstagio(admin, ctx.leadId, "link_enviado", { origem: "agente", produto });

  // Link novo abre ciclo novo: zera o contador de toques e qualquer pausa
  // herdada de um ciclo anterior.
  await reiniciarCiclo(admin, ctx.conversaId);

  return { conteudo: `Link do ${rotulo} para enviar ao cliente: ${link.url}` };
}

async function executarResultadoCompra(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const resultado = argumentos.resultado as ResultadoCompra;
  if (!RESULTADOS.includes(resultado)) {
    return {
      conteudo: `Erro: resultado "${String(resultado)}" é inválido. Use: ${RESULTADOS.join(", ")}.`,
    };
  }

  const detalhe =
    typeof argumentos.detalhe === "string" && argumentos.detalhe.trim()
      ? argumentos.detalhe.trim()
      : "sem detalhe informado";

  if (resultado === "comprou") {
    await moverEstagio(admin, ctx.leadId, "convertido", { origem: "agente", detalhe });
    // A régua morre aqui: quem comprou não recebe toque de remarketing.
    await limparAgendamento(admin, ctx.conversaId);
    return {
      conteudo:
        "ok, cliente convertido. A régua de acompanhamento foi encerrada e você entra em modo " +
        "pós-venda: ajude com cadastro, documentos, ativação e chave Pix.",
    };
  }

  if (resultado === "nao_comprou") {
    // Registra o evento de negócio ANTES de mover o estágio: moverEstagio
    // grava o seu próprio evento "mudou_estagio" em eventos_lead, e o motivo
    // da não-compra precisa ser o primeiro registro, não o segundo.
    await registrarEvento(admin, ctx.leadId, "nao_comprou", { motivo: detalhe });
    await moverEstagio(admin, ctx.leadId, "contornando_objecao", { origem: "agente" });
    return {
      conteudo:
        `ok, registrado que ele não comprou. Motivo: "${detalhe}". Agora quebre essa objeção ` +
        "na sua próxima mensagem, usando o material — não desista e não repita argumento que " +
        "já apareceu na conversa.",
    };
  }

  await registrarNaoPerturbe(admin, {
    leadId: ctx.leadId,
    conversaId: ctx.conversaId,
    motivo: detalhe,
  });
  return {
    conteudo:
      "ok, o lead foi marcado como não perturbe: nenhuma mensagem automática sai mais para " +
      "ele, e o Pedro foi avisado. Não responda mais nada neste turno.",
    escalou: true,
  };
}

async function executarEscalar(
  admin: any,
  argumentos: Record<string, unknown>,
  ctx: ContextoTool,
): Promise<ResultadoTool> {
  const motivo =
    typeof argumentos.motivo === "string" && argumentos.motivo.trim()
      ? argumentos.motivo.trim()
      : "sem motivo informado";

  await marcarPrecisaAtencao(admin, ctx.leadId, motivo);
  await pausarIa(admin, ctx.conversaId);

  return { conteudo: "ok, conversa passada para o Pedro", escalou: true };
}
