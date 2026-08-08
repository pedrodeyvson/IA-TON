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

const FUSO = "America/Sao_Paulo";

/** Dia civil em São Paulo, como "2026-08-08". Fixar o fuso é o que faz o
 *  servidor e o navegador concordarem: sem isso o SSR formata em UTC e o
 *  cliente em -03, e depois da 21h os dois discordariam do dia. */
function diaEmSaoPaulo(data: Date): string {
  return data.toLocaleDateString("en-CA", { timeZone: FUSO });
}

/**
 * Horário da última mensagem no padrão de app de conversa: só a hora quando é
 * de hoje, "ontem", e a data para o resto. Recebe `agora` para ser testável
 * sem congelar o relógio.
 */
export function rotuloDeHorario(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";

  const dia = diaEmSaoPaulo(data);
  if (dia === diaEmSaoPaulo(agora)) {
    return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });
  }

  const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
  if (dia === diaEmSaoPaulo(ontem)) return "ontem";

  // Ano só quando não é o corrente — "05/02" basta para o inbox do dia a dia.
  const mesmoAno = dia.slice(0, 4) === diaEmSaoPaulo(agora).slice(0, 4);
  return data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    ...(mesmoAno ? {} : { year: "2-digit" }),
    timeZone: FUSO,
  });
}

export function resumoDaLinha(conversa: any): { titulo: string; assumida: boolean } {
  const titulo = conversa?.nome?.trim() || conversa?.telefone || "Sem identificação";
  const assumida = Boolean(conversaEmbutida(conversa)?.pausada_pela_ia);
  return { titulo, assumida };
}
