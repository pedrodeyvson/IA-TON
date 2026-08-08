// Apresentação pura: sem React, sem banco, sem alias — para o node --test
// conseguir importar.

const ROTULOS: Record<string, string> = {
  novo: "Novo",
  qualificando: "Qualificando",
  apresentando_solucao: "Apresentando solução",
  contornando_objecao: "Contornando objeção",
  link_enviado: "Link enviado",
  acompanhamento: "Acompanhamento",
  convertido: "Convertido",
  perdido: "Perdido",
};

/** Estágio desconhecido volta como veio: um funil novo no banco não pode
 *  deixar a linha em branco antes de alguém atualizar este mapa. */
export function rotuloDeEstagio(estagio: string): string {
  return ROTULOS[estagio] ?? estagio;
}

/**
 * Extrai a conversa embutida de uma linha de `listarConversas`.
 *
 * O PostgREST decide a forma do embed pela cardinalidade que ele detecta:
 * como `conversas.lead_id` é UNIQUE (1 conversa por lead), ele devolve um
 * OBJETO, não um array. O código nasceu fazendo `conversas?.[0]`, que num
 * objeto dá `undefined` — e o resultado era todo link do inbox desabilitado e
 * toda linha marcada como "IA respondendo". Passou despercebido porque o
 * dublê do teste montava um array, forma que a API nunca devolveu.
 *
 * Aceita as duas formas de propósito: se alguém remover o índice único, o
 * PostgREST volta a mandar array e isto continua funcionando.
 */
export function conversaEmbutida(linha: any): any | null {
  const bruto = linha?.conversas;
  if (!bruto) return null;
  if (Array.isArray(bruto)) return bruto[0] ?? null;
  return bruto;
}

export function resumoDaLinha(conversa: any): { titulo: string; assumida: boolean } {
  const titulo = conversa?.nome?.trim() || conversa?.telefone || "Sem identificação";
  const assumida = Boolean(conversaEmbutida(conversa)?.pausada_pela_ia);
  return { titulo, assumida };
}
