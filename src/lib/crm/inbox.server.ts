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

  const { data: lead } = await admin
    .from("leads")
    .select("id, telefone")
    .eq("id", params.leadId)
    .maybeSingle();

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
