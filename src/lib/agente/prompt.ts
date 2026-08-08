// Puro: monta o system prompt (por modo) e converte o histórico do banco em
// mensagens de chat.
//
// O prompt NUNCA contém URL. O modelo escolhe um productId da lista abaixo e a
// tool registrar_link_enviado devolve o endereço pronto — assim não há como ele
// colar link cedo, digitar errado ou vazar o referrer numa conversa qualquer.
import {
  ANGULO_DO_TOQUE,
  CONHECIMENTO_POS_VENDA,
  CONHECIMENTO_VENDA,
  REGRAS_ESCALACAO,
} from "./conhecimento.ts";
import { PRODUTOS } from "./links.ts";
import { TOTAL_DE_TOQUES } from "../crm/regua.ts";

export type ModoDoAgente = "venda" | "pos_venda";

export type LeadNoPrompt = {
  nome?: string | null;
  estagio: string;
  maquina_interesse?: string | null;
};

export type MensagemHistorico = {
  remetente: string;
  tipo?: string | null;
  conteudo?: string | null;
  transcricao?: string | null;
  transcricao_status?: string | null;
};

export type MensagemChat = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
};

/** Só produtos com nome comercial no material entram na lista do modelo. */
function catalogoParaOModelo(): string {
  const linhas = Object.entries(PRODUTOS)
    .filter(([, dados]) => dados.nome !== null)
    .map(([id, dados]) => `- ${id} — ${dados.nome}`);

  return [
    "- catalogo — quando o cliente ainda não escolheu a máquina; ele navega e decide",
    ...linhas,
  ].join("\n");
}

const COMO_USAR_AS_TOOLS = `
## As suas tools

- **atualizar_lead** — grave o que descobrir: nome, máquina de interesse e estágio da conversa.
  Chame assim que souber algo novo, sem esperar o fim do papo.
- **registrar_link_enviado** — você escolhe o PRODUTO e ela devolve o link pronto para você
  colar na resposta. **Você nunca escreve endereço nenhum.** Chame só depois de qualificar e
  quando o cliente demonstrar intenção de COMPRAR — "quero essa", "como faço pra pegar",
  "bora fechar", "pode mandar o link". **Responder qual máquina quer VER ou COMPARAR não é
  pedido de compra** — se ele disse só "T3" respondendo "quer ver a T2 ou a T3?", isso é
  escolha de comparação, não intenção de fechar; continue comparando/qualificando e só chame
  esta tool quando ele confirmar que quer aquela máquina de verdade. Se ele ainda não decidiu
  a máquina, escolha "catalogo".
- **registrar_resultado_compra** — quando o cliente disser o que aconteceu:
  "comprou" (aí você entra em modo pós-venda), "nao_comprou" (mande o motivo em detalhe e
  quebre a objeção na mesma mensagem, sem desistir) ou "nao_perturbe" (ele pediu para parar).
- **escalar_para_humano** — passa a conversa para o Pedro e encerra o seu turno.

### Produtos que você pode escolher em registrar_link_enviado

${catalogoParaOModelo()}

O Ton Black só existe para CNPJ e só nos níveis T3 e T3 Smart — não ofereça para CPF.
`.trim();

export function montarSystemPrompt(params: {
  lead: LeadNoPrompt;
  modo: ModoDoAgente;
}): string {
  const { lead, modo } = params;
  const nome = lead.nome?.trim();
  const maquina = lead.maquina_interesse?.trim();

  const estado = [
    nome ? `Nome: ${nome}` : "Nome: ainda não sabemos — descubra naturalmente na conversa.",
    `Estágio no funil: ${lead.estagio}`,
    maquina ? `Máquina de interesse: ${maquina}` : "Máquina de interesse: ainda não definida.",
  ].join("\n");

  const base = modo === "pos_venda" ? CONHECIMENTO_POS_VENDA : CONHECIMENTO_VENDA;

  return [base, REGRAS_ESCALACAO, COMO_USAR_AS_TOOLS, "## Estado deste lead", estado].join(
    "\n\n",
  );
}

/**
 * O gatilho de um toque da régua. Entra como mensagem `system` do turno, não
 * como fala do cliente — não existe mensagem nova do lead aqui.
 *
 * O histórico completo vai junto no turno; é ele que impede a repetição de
 * argumento, que é a regra dura do material.
 */
export function instrucaoDoToque(toque: number): string {
  if (!Number.isInteger(toque) || toque < 1 || toque > TOTAL_DE_TOQUES) {
    throw new Error(`toque ${toque} está fora da cadência (1..${TOTAL_DE_TOQUES})`);
  }

  return [
    `Você está no toque ${toque} de ${TOTAL_DE_TOQUES} do acompanhamento. O cliente recebeu o`,
    "link e não voltou a falar.",
    "",
    `Ângulo deste toque: ${ANGULO_DO_TOQUE[toque as 1 | 2 | 3 | 4]}`,
    "",
    "Regras deste turno:",
    "- Mande uma única mensagem, curta, que caiba em uma tela de WhatsApp.",
    "- Não repita argumento que já apareceu nesta conversa. Cada toque precisa de motivo novo.",
    "- Não invente prazo, cupom que está acabando nem escassez. Urgência falsa é proibida.",
    "- Não cole o link de novo e não cobre resposta.",
    "- Só use as tools atualizar_lead, registrar_resultado_compra ou escalar_para_humano.",
  ].join("\n");
}

const MARCADOR_MIDIA: Record<string, string> = {
  imagem: "imagem",
  documento: "documento",
  video: "vídeo",
  sticker: "figurinha",
};

/**
 * O que o lead escreveu, resolvendo áudio e mídia para texto.
 *
 * Mídia visual (imagem/documento/vídeo/sticker) SEMPRE leva o marcador
 * "[o cliente enviou uma imagem...]", com ou sem legenda — não é vision, o
 * modelo nunca viu o conteúdo. Sem isso, uma imagem com legenda ("essa
 * aqui?") virava texto puro e o modelo respondia como se tivesse visto a
 * foto, sem nunca ter tido acesso a ela (achado real em produção).
 */
function textoDaMensagem(m: MensagemHistorico): string | null {
  const rotuloMidia = MARCADOR_MIDIA[m.tipo ?? ""];
  const conteudo = m.conteudo?.trim();

  if (rotuloMidia) {
    return conteudo
      ? `[o cliente enviou uma ${rotuloMidia}, com esta legenda: "${conteudo}"]`
      : `[o cliente enviou uma ${rotuloMidia}]`;
  }

  if (conteudo) return conteudo;

  const transcricao = m.transcricao?.trim();
  if (transcricao) return transcricao;

  // Áudio sem transcrição: um marcador é melhor que sumir com a mensagem.
  if (m.tipo === "audio") return "[o cliente enviou um áudio que não foi possível transcrever]";
  return null;
}

export function montarMensagens(
  systemPrompt: string,
  historico: MensagemHistorico[],
): MensagemChat[] {
  const mensagens: MensagemChat[] = [{ role: "system", content: systemPrompt }];

  for (const m of historico) {
    const texto = textoDaMensagem(m);
    if (!texto) continue;
    // "humano" é o Pedro respondendo pelo inbox. Do ponto de vista do lead é a
    // mesma voz, então entra como assistant.
    mensagens.push({ role: m.remetente === "lead" ? "user" : "assistant", content: texto });
  }

  return mensagens;
}
