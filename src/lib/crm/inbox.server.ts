// Resposta manual do Pedro pelo inbox. Fica separado de mensagens.server.ts
// porque coordena três módulos (conversa, mensagem, lead) e nenhum deles é
// dono dos três — mesma razão de nao-perturbe.server.ts existir à parte.
import { marcarLida, pausarIa } from "./conversas.server.ts";
import { enviarTextoDoCrm } from "./mensagens.server.ts";

export type ParamsResposta = {
  conversaId: string;
  leadId: string;
  texto: string;
};

export type DepsResposta = {
  /** Injetável só para teste. Em produção resolve para a UAZAPI. */
  enviar?: (numero: string, texto: string) => Promise<any>;
};

/**
 * Responder é assumir: pausa a IA, envia como "humano" e zera as não lidas.
 *
 * A ordem importa. Se o envio viesse antes da pausa, um worker que acordasse
 * na janela entregaria ao lead a mensagem do Pedro e a da IA quase juntas,
 * possivelmente se contradizendo.
 *
 * O telefone é lido do banco, nunca recebido por parâmetro: esta função é
 * alcançável pela internet através de uma server function rodando com service
 * role, e aceitar o número de fora transformaria o inbox num disparador de
 * WhatsApp para qualquer destino.
 *
 * Nunca lança — devolve { ok, erro }, no mesmo contrato de enviarTextoDoCrm.
 */
export async function responderComoHumano(
  admin: any,
  params: ParamsResposta,
  deps: DepsResposta = {},
): Promise<{ ok: boolean; erro?: string }> {
  const texto = params.texto?.trim();
  if (!texto) return { ok: false, erro: "texto vazio" };

  const { data: lead, error: erroLead } = await admin
    .from("leads")
    .select("id, telefone")
    .eq("id", params.leadId)
    .maybeSingle();

  // Distinguir falha de banco de lead inexistente: o supabase-js resolve com
  // { data, error } em vez de rejeitar, então ignorar o error faria uma queda
  // de conexão chegar ao operador como "lead não encontrado".
  if (erroLead) return { ok: false, erro: erroLead.message };
  if (!lead) return { ok: false, erro: "lead não encontrado" };
  if (!lead.telefone) {
    // Lead que chegou só com @lid: não há para onde enviar. A tela desabilita
    // a caixa de resposta com esta explicação.
    return { ok: false, erro: "lead sem telefone real — não é possível responder" };
  }

  await pausarIa(admin, params.conversaId);

  const envio = await enviarTextoDoCrm(
    admin,
    {
      conversaId: params.conversaId,
      leadId: params.leadId,
      telefone: lead.telefone,
      texto,
      remetente: "humano",
    },
    deps.enviar ? { enviar: deps.enviar } : {},
  );

  // Abrir a conversa e responder é a definição de "li": mesmo com falha no
  // envio, as não lidas foram vistas.
  await marcarLida(admin, params.leadId);

  return envio;
}

/**
 * Reenvia uma mensagem que ficou em `falhou`, reaproveitando a MESMA linha.
 *
 * Inserir uma linha nova deixaria a original em `falhou` para sempre: o botão
 * de reenviar não sumiria da tela e cada clique viraria outro WhatsApp para o
 * lead. Passar por `pendente` também é o que torna o duplo clique inofensivo —
 * a segunda chamada encontra a mensagem fora de `falhou` e recusa.
 */
export async function reenviarFalhada(
  admin: any,
  mensagemId: string,
  deps: DepsResposta = {},
): Promise<{ ok: boolean; erro?: string }> {
  const { data: mensagem, error: erroLeitura } = await admin
    .from("mensagens")
    .select("id, conversa_id, lead_id, conteudo, status")
    .eq("id", mensagemId)
    .maybeSingle();

  if (erroLeitura) return { ok: false, erro: erroLeitura.message };
  if (!mensagem) return { ok: false, erro: "mensagem não encontrada" };
  if (mensagem.status !== "falhou") return { ok: false, erro: "mensagem não está falhada" };

  const texto = mensagem.conteudo?.trim();
  if (!texto) return { ok: false, erro: "mensagem sem texto para reenviar" };

  const { data: lead, error: erroLead } = await admin
    .from("leads")
    .select("id, telefone")
    .eq("id", mensagem.lead_id)
    .maybeSingle();

  if (erroLead) return { ok: false, erro: erroLead.message };
  if (!lead?.telefone) return { ok: false, erro: "lead sem telefone real" };

  await admin.from("mensagens").update({ status: "pendente" }).eq("id", mensagemId);

  const enviar = deps.enviar ?? (await enviarPelaUazapi());
  let resposta: any;
  try {
    resposta = await enviar(lead.telefone, texto);
  } catch (err: any) {
    await admin.from("mensagens").update({ status: "falhou" }).eq("id", mensagemId);
    return { ok: false, erro: err?.message ?? "erro desconhecido ao reenviar" };
  }

  await admin
    .from("mensagens")
    .update({ status: "enviada", provider_message_id: resposta?.messageid ?? resposta?.id ?? null })
    .eq("id", mensagemId);

  return { ok: true };
}

/** Resolve o envio real só quando não há dublê — mantém a UAZAPI fora do teste. */
async function enviarPelaUazapi(): Promise<(numero: string, texto: string) => Promise<any>> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) throw new Error("UAZAPI_TOKEN não configurado");
  const { enviarTexto } = await import("../uazapi/client.server.ts");
  return (numero, texto) => enviarTexto(token, numero, texto);
}
