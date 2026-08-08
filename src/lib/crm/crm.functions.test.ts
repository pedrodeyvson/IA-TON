import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// As server functions dependem do runtime do TanStack e não são importáveis
// aqui. O que importa verificar é estrutural, e o código-fonte basta.
const FONTE_CRM = readFileSync(new URL("./crm.functions.ts", import.meta.url), "utf8");
const FONTE_AUTH = readFileSync(new URL("../auth/auth.functions.ts", import.meta.url), "utf8");

/** Nome da const exportada em cada `export const X = createServerFn(`. */
function nomesDeServerFn(fonte: string): string[] {
  const nomes: string[] = [];
  const re = /export\s+const\s+(\w+)\s*=\s*createServerFn\s*\(/g;
  let achado: RegExpExecArray | null;
  while ((achado = re.exec(fonte))) nomes.push(achado[1]);
  return nomes;
}

/** Trecho entre `export const X =` e o próximo `export const` (ou o fim). */
function corpoDaDeclaracao(fonte: string, nome: string): string {
  const inicio = fonte.indexOf(`export const ${nome} =`);
  assert.notEqual(inicio, -1, `não achei a declaração de ${nome}`);
  const proximo = fonte.indexOf("export const ", inicio + 1);
  return fonte.slice(inicio, proximo === -1 ? undefined : proximo);
}

test("crm.functions.ts declara pelo menos uma server function", () => {
  assert.ok(nomesDeServerFn(FONTE_CRM).length > 0);
});

test("TODA server function do CRM exige sessão", () => {
  // O client é de service role e ignora o RLS: uma função sem exigirSessao é
  // um endpoint público de escrita no banco.
  for (const nome of nomesDeServerFn(FONTE_CRM)) {
    const corpo = corpoDaDeclaracao(FONTE_CRM, nome);
    assert.ok(
      /\.middleware\(\[[^\]]*\bexigirSessao\b[^\]]*\]\)/.test(corpo),
      `${nome} não encadeia exigirSessao — endpoint público de escrita`,
    );
  }
});

test("as únicas server functions sem exigirSessao são as três de auth", () => {
  const SEM_SESSAO_PERMITIDAS = ["entrar", "sair", "obterSessaoAtual"];
  const semSessao = nomesDeServerFn(FONTE_AUTH).filter(
    (nome) => !/\bexigirSessao\b/.test(corpoDaDeclaracao(FONTE_AUTH, nome)),
  );
  assert.deepEqual(semSessao.sort(), [...SEM_SESSAO_PERMITIDAS].sort());
});

test("toda server function do CRM valida a entrada ou não recebe nenhuma", () => {
  for (const nome of nomesDeServerFn(FONTE_CRM)) {
    const corpo = corpoDaDeclaracao(FONTE_CRM, nome);
    const recebeDados = /handler\(\s*async\s*\(\s*\{\s*data/.test(corpo);
    if (recebeDados) {
      // `.validator(` e não `.inputValidator(`: este último é alias
      // @deprecated na versão instalada do TanStack Start, e o regex recusá-lo
      // é o que impede a API antiga de voltar sem ninguém notar.
      assert.ok(
        /\.validator\(/.test(corpo),
        `${nome} lê data sem validator — entrada não validada`,
      );
    }
  }
});
