// Puro: janela de silêncio do resgate pré-link — 21h às 08h em São Paulo
// (spec §4, decisão do dono). Toque que cairia dentro da janela é ADIADO
// para a abertura seguinte (8h em SP), NUNCA perdido — o relógio da cadência
// não zera, só desloca.
//
// O bloqueio vale só para mensagem PROATIVA (toque de resgate/follow-up);
// resposta direta a uma mensagem do lead sai na hora, de madrugada ou não —
// quem procurou foi ele. Isso é decidido pelo call site (Task 3), não aqui.
//
// Fuso fixo com `Intl.DateTimeFormat` + `timeZone`, mesma técnica de
// `rotulos.ts:diaEmSaoPaulo`. NÃO usar `Date.getHours()`/`Date.getUTCHours()`
// isolado: o primeiro lê o fuso do processo (UTC no servidor, -03 no
// navegador — SSR e cliente discordam), o segundo ignora São Paulo por
// completo. Esse descompasso já foi um bug corrigido nesta base (ver o
// comentário em `rotulos.ts` sobre SSR em UTC vs cliente em -03).

export const FUSO_FOLLOWUP = "America/Sao_Paulo";
export const HORA_INICIO_JANELA = 8; // volta a mandar às 8h
export const HORA_FIM_JANELA = 21; // para de mandar às 21h

const MS_POR_MINUTO = 60_000;

type PartesEmSaoPaulo = {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number; // 0-23
  /** Offset de São Paulo em relação a UTC, em minutos (hoje sempre -180: o
   *  Brasil não tem mais horário de verão desde 2019). Lido do próprio
   *  `Intl`, não hardcoded, para sobreviver a uma eventual mudança de lei. */
  offsetMinutos: number;
};

const FORMATADOR = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO_FOLLOWUP,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23", // força 0-23; hour12:false já basta no Node atual, mas h23 é explícito contra o bug clássico de meia-noite virar "24"
  timeZoneName: "shortOffset",
});

function partesEmSaoPaulo(quandoMs: number): PartesEmSaoPaulo {
  const partes = FORMATADOR.formatToParts(new Date(quandoMs));
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";

  const offsetTexto = valor("timeZoneName"); // ex.: "GMT-3"
  const casado = offsetTexto.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  const offsetHoras = casado ? Number(casado[1]) : 0;
  const offsetMinutosFracao = casado?.[2] ? Number(casado[2]) : 0;
  const offsetMinutos = offsetHoras * 60 + Math.sign(offsetHoras || 1) * offsetMinutosFracao;

  return {
    ano: Number(valor("year")),
    mes: Number(valor("month")),
    dia: Number(valor("day")),
    hora: Number(valor("hour")),
    offsetMinutos,
  };
}

/** true se `quandoMs` cai dentro da janela de silêncio (21h-08h em SP). */
export function estaNaJanelaDeSilencio(quandoMs: number): boolean {
  const { hora } = partesEmSaoPaulo(quandoMs);
  return hora >= HORA_FIM_JANELA || hora < HORA_INICIO_JANELA;
}

/**
 * Se `quandoMs` cai no silêncio, devolve o instante das `HORA_INICIO_JANELA`h
 * seguintes em São Paulo. Senão devolve `quandoMs` sem alteração. NUNCA perde
 * o toque — desloca.
 */
export function proximaAberturaSeSilencio(quandoMs: number): number {
  if (!estaNaJanelaDeSilencio(quandoMs)) return quandoMs;

  const { ano, mes, dia, hora, offsetMinutos } = partesEmSaoPaulo(quandoMs);

  // Já é madrugada (0h-08h em SP): abre no mesmo dia civil de SP. Ainda é
  // noite (>=21h em SP): abre no dia civil seguinte.
  const diasParaFrente = hora >= HORA_FIM_JANELA ? 1 : 0;

  // Constrói HORA_INICIO_JANELA:00 em SP "como se fosse UTC" (mesmos campos
  // de data/hora, tratados como UTC) e depois desconta o offset real de SP
  // para chegar no instante UTC correto. Evita depender do fuso do processo.
  const comoSeFosseUtc = Date.UTC(ano, mes - 1, dia + diasParaFrente, HORA_INICIO_JANELA, 0, 0, 0);
  return comoSeFosseUtc - offsetMinutos * MS_POR_MINUTO;
}
