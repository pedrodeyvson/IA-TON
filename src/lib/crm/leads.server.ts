// Núcleo de lead. Recebe o client `admin` por parâmetro (mesmo formato de
// ingerirEvento) — não cria client, não lê env, não depende de sessão. Isso
// deixa o módulo testável sem HTTP e usável tanto pelo agente quanto pelas
// createServerFn que virão na Fatia 4.
import { camposDeTransicao, type Estagio } from "./estagios.ts";
import type { DadosParaSincronizar } from "../capi/capi.server.ts";

/** Assinatura de `sincronizarEventosCapi` — só o tipo, sem importar o módulo
 *  estaticamente (ver `moverEstagio`, que carrega `capi.server.ts` por
 *  import dinâmico). */
type FuncaoSincronizarCapi = (
  admin: any,
  leadId: string,
  estagioAtual: string,
  dados: DadosParaSincronizar,
) => Promise<void>;

export type DepsMoverEstagio = {
  /** Injeção de dependência opcional, só para teste (espião). Em produção
   *  nunca é passado — moverEstagio resolve via import dinâmico de
   *  capi.server.ts, o que mantém esse módulo (e o fetch para a Meta que ele
   *  carrega transitivamente) fora do bundle de quem só lê/edita leads. */
  sincronizarCapi?: FuncaoSincronizarCapi;
};

export async function obterLead(admin: any, leadId: string): Promise<any | null> {
  const { data } = await admin.from("leads").select("*").eq("id", leadId).maybeSingle();
  return data ?? null;
}

export type CamposEditaveis = {
  nome?: string | null;
  maquina_interesse?: string | null;
};

export async function atualizarLead(
  admin: any,
  leadId: string,
  campos: CamposEditaveis,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(campos)) {
    if (valor !== undefined) payload[chave] = valor;
  }
  // Sem nada para mudar, não gasta round-trip nem suja o atualizado_em.
  if (Object.keys(payload).length === 0) return;

  await admin.from("leads").update(payload).eq("id", leadId);
}

async function registrarEvento(
  admin: any,
  leadId: string,
  tipoEvento: string,
  detalhe: Record<string, unknown>,
): Promise<void> {
  await admin.from("eventos_lead").insert({ lead_id: leadId, tipo_evento: tipoEvento, detalhe });
}

/**
 * Move o lead de estágio e deixa rastro em eventos_lead — é o que alimenta o
 * funil da Fatia 4, mesmo papel do crm_lead_eventos no CPI.
 * Devolve false quando não houve mudança (lead inexistente ou mesmo estágio).
 */
export async function moverEstagio(
  admin: any,
  leadId: string,
  para: Estagio,
  detalheExtra: Record<string, unknown> = {},
  deps: DepsMoverEstagio = {},
): Promise<boolean> {
  const lead = await obterLead(admin, leadId);
  if (!lead) return false;

  const de = lead.estagio as Estagio;
  const campos = camposDeTransicao(de, para, new Date().toISOString());
  if (Object.keys(campos).length === 0) return false;

  await admin.from("leads").update(campos).eq("id", leadId);
  await registrarEvento(admin, leadId, "mudou_estagio", { de, para, ...detalheExtra });

  // Alimenta o Meta Ads a cada avanço de estágio — best-effort, nunca pode
  // custar a transição que já foi gravada acima. Se falhar aqui, o
  // self-healing no ingest.server.ts tenta de novo na próxima mensagem do
  // lead.
  try {
    const sincronizarCapi =
      deps.sincronizarCapi ?? (await import("../capi/capi.server.ts")).sincronizarEventosCapi;
    await sincronizarCapi(admin, leadId, para, {
      ctwaClid: lead.ctwa_clid,
      adSourceId: lead.ad_source_id,
      telefone: lead.telefone,
      nome: lead.nome,
      comissaoEstimada: lead.comissao_estimada,
    });
  } catch (err: any) {
    console.warn(`[crm] falha ao sincronizar CAPI do lead ${leadId}:`, err?.message ?? err);
  }

  return true;
}

export async function marcarPrecisaAtencao(
  admin: any,
  leadId: string,
  motivo: string,
): Promise<void> {
  await admin.from("leads").update({ precisa_atencao: true }).eq("id", leadId);
  await registrarEvento(admin, leadId, "escalado", { motivo });
}

export async function registrarNota(admin: any, leadId: string, texto: string): Promise<void> {
  await registrarEvento(admin, leadId, "nota", { texto });
}
