// Puro e isomórfico: sem React, sem alias, seguro no SSR e testável sob
// `node --test` (que não tem DOM).

/**
 * O 401 do middleware, reconhecido em qualquer das formas em que chega.
 *
 * `exigirSessao` lança `new Response("nao_autenticado", { status: 401 })`. O
 * handler de server function devolve essa Response intacta ao cliente, e o
 * fetcher do TanStack Start converte resposta não-ok em
 * `new Error(await response.text())` — então no browser o erro chega como
 * `Error("nao_autenticado")`. Interceptado antes disso (SSR, `beforeLoad`), ele
 * chega como a própria `Response` ou como objeto com `status`.
 *
 * Deliberadamente estreito: um falso positivo manda o operador para o login por
 * causa de uma falha de rede e ele perde o contexto da conversa. 403 (logado,
 * sem permissão) e 500 não contam — ir ao login não resolve nenhum dos dois.
 */
export function ehNaoAutenticado(erro: unknown): boolean {
  if (!erro) return false;

  if (typeof erro === "object") {
    const status = (erro as { status?: unknown }).status;
    // Quem tem `status` já disse tudo o que precisava: só 401 é sessão expirada.
    if (typeof status === "number") return status === 401;
  }

  // "nao_autenticado" é sentinela do middleware, não texto que uma falha de
  // rede produza. `includes` em vez de igualdade porque a mensagem pode chegar
  // envelopada por outra camada.
  if (erro instanceof Error) return erro.message.includes("nao_autenticado");

  return false;
}

/** Fatia do `sessionStorage` que o rascunho usa. Injetável para teste. */
export type ArmazenamentoRascunho = {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
};

/**
 * `sessionStorage` do browser, ou null fora dele.
 *
 * Envolto em try/catch porque em navegador com cookies de terceiros bloqueados
 * o simples acesso à propriedade já lança `SecurityError`.
 */
function armazenamentoPadrao(): ArmazenamentoRascunho | null {
  try {
    if (!("sessionStorage" in globalThis)) return null;
    return (globalThis as { sessionStorage?: ArmazenamentoRascunho }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Uma chave por conversa: trocar de conversa não pode mostrar o texto da outra. */
function chave(conversaId: string): string {
  return `rascunho:${conversaId}`;
}

/**
 * Guarda o rascunho da conversa. Texto vazio (ou só espaço) apaga a chave em
 * vez de gravar string vazia — rascunho vazio não é rascunho, é lixo que fica.
 *
 * Nunca lança: cota cheia ou modo privado não podem derrubar a caixa de
 * resposta, que é onde o operador está digitando.
 */
export function guardarRascunho(
  conversaId: string,
  texto: string,
  armazenamento: ArmazenamentoRascunho | null = armazenamentoPadrao(),
): void {
  if (!armazenamento) return;
  try {
    if (texto.trim() === "") armazenamento.removeItem(chave(conversaId));
    else armazenamento.setItem(chave(conversaId), texto);
  } catch {
    // Perder o rascunho é ruim; quebrar a tela por causa disso é pior.
  }
}

/** Rascunho da conversa, ou "" se não houver (nunca null, nunca undefined). */
export function lerRascunho(
  conversaId: string,
  armazenamento: ArmazenamentoRascunho | null = armazenamentoPadrao(),
): string {
  if (!armazenamento) return "";
  try {
    return armazenamento.getItem(chave(conversaId)) ?? "";
  } catch {
    return "";
  }
}

/** Apaga o rascunho da conversa — só o dela. */
export function limparRascunho(
  conversaId: string,
  armazenamento: ArmazenamentoRascunho | null = armazenamentoPadrao(),
): void {
  if (!armazenamento) return;
  try {
    armazenamento.removeItem(chave(conversaId));
  } catch {
    // idem
  }
}

/**
 * Envolve o retorno de uma server function usada em `queryFn`.
 *
 * Motivo: o fetcher do TanStack Start devolve a `Response` CRUA quando ela vem
 * com `x-tss-raw: true`, que é o caso do 401 do `exigirSessao`. A promessa
 * RESOLVE — não rejeita. Sem isto, a sessão expirada não vira erro: vira um
 * objeto `Response` no lugar dos dados, e o componente quebra tentando usá-lo
 * (visto ao vivo: `mensagens.map is not a function` no Historico).
 *
 * Aqui o 401 volta a ser o que sempre deveria ter sido — um erro — e o
 * operador vai para o login em vez de olhar uma tela quebrada.
 */
export async function comSessao<T>(
  promessa: Promise<T>,
  irParaLogin: () => void = redirecionarParaLogin,
): Promise<T> {
  const resultado = await promessa;
  if (ehNaoAutenticado(resultado)) {
    irParaLogin();
    throw new Error("nao_autenticado");
  }
  return resultado;
}

/** Manda para o login preservando de onde o operador saiu. No-op fora do browser. */
export function redirecionarParaLogin(): void {
  if (typeof window === "undefined") return;
  const destino = window.location.pathname + window.location.search;
  const url = `/login?destino=${encodeURIComponent(destino)}`;
  // Só navega se ainda não estamos indo para lá: várias queries falham juntas
  // quando a sessão cai, e sem esta guarda cada uma dispara uma navegação.
  if (window.location.pathname !== "/login") window.location.assign(url);
}
