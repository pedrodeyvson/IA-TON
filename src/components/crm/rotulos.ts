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

export function resumoDaLinha(conversa: any): { titulo: string; assumida: boolean } {
  const titulo = conversa?.nome?.trim() || conversa?.telefone || "Sem identificação";
  const assumida = Boolean(conversa?.conversas?.[0]?.pausada_pela_ia);
  return { titulo, assumida };
}
