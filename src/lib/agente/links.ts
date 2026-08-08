// Template de link de indicação + mapa de produtos.
//
// O modelo NUNCA escreve URL: ele escolhe qual produto, e este módulo monta o
// endereço. Assim não há como colar link errado, truncado ou de outro parceiro.
//
// Só o referrer é segredo de ambiente (TON_REFERRER). O mapa de produtos é
// tabela em código de propósito: são identificadores públicos de produto, e
// versioná-los deixa o mapa revisável em code review.
//
// O nome comercial de cada productId saiu de docs/conhecimento/produtos-e-taxas.md
// (extraído de guia_maquinas.pdf + tabela-adesao-rex.pdf). NÃO se deduz pelo
// código do hardware — foi lido no manual, seção por seção. Em 2026-08-08 os
// seis links foram visitados de verdade (Playwright) para conferir nome e
// preço exibidos na própria página Ton — ver docs/conhecimento/links-verificados.md.
// Essa visita também resolveu o D150, que os PDFs não citavam (ver abaixo).

export const PRODUTOS = {
  // Seção 1.1 — nível T3 Smart (POS Android). Ton Black é exclusivo do Renda
  // Ton, só CNPJ e só T3/T3 Smart.
  TONBLACK_TIER_SMART_POS: {
    userTag: "tonblack_tier",
    nome: "T3 Smart no plano Ton Black",
    fonte:
      "produtos-e-taxas.md §1.1 e §6 (elegibilidade do Ton Black); " +
      "confirmado como 'T3 Smart Ton Black' no carrinho ao vivo — links-verificados.md §1",
  },
  TONMEGA_TIER_SMART_POS: {
    userTag: "tonmega_tier",
    nome: "T3 Smart no plano Ton Mega+",
    fonte:
      "produtos-e-taxas.md §1.1; confirmado como 'T3 Smart' no catálogo e " +
      "'T3 Smart Ton Mega+' no carrinho ao vivo — links-verificados.md §2",
  },
  // Seção 1.2 — o S920 está listado no nível T3, não no T3 Smart.
  TONMEGA_TIER_S920: {
    userTag: "tonmega_tier",
    nome: "T3 no plano Ton Mega+ (modelo S920)",
    fonte:
      "produtos-e-taxas.md §1.2; confirmado como 'T3' no catálogo e " +
      "'T3 Ton Mega+' no carrinho ao vivo — links-verificados.md §3",
  },
  // Seção 1.3 — o D195 está listado no nível T2.
  TONMEGA_TIER_D195: {
    userTag: "tonmega_tier",
    nome: "T2 no plano Ton Mega+ (modelo D195)",
    fonte:
      "produtos-e-taxas.md §1.3; confirmado como 'T2' no catálogo e " +
      "'T2 Ton Mega+' no carrinho ao vivo — links-verificados.md §4",
  },
  // D150 NÃO aparece em nenhum dos 10 documentos lidos. Mas visitando a
  // página de verdade (2026-08-08): o botão "Pedir T1" do catálogo aponta
  // para productId=TONMEGA_TIER_D150, e o carrinho desse productId rotula o
  // item "T1 Ton Mega+" — preço (R$16,80 / 12x R$1,40) bate com o T1 de
  // produtos-e-taxas.md §1.0. D150 = T1. Ver links-verificados.md §5.
  TONMEGA_TIER_D150: {
    userTag: "tonmega_tier",
    nome: "T1 no plano Ton Mega+ (modelo D150)",
    fonte:
      "NÃO CONSTA em nenhum dos 10 PDFs — nome encontrado visitando a página " +
      "de checkout ao vivo (carrinho rotula 'T1 Ton Mega+') — links-verificados.md §5",
  },
} as const;

export type ProdutoId = keyof typeof PRODUTOS;
export type AlvoDeLink = ProdutoId | "catalogo";

export const ALVOS_DE_LINK: readonly AlvoDeLink[] = [
  ...(Object.keys(PRODUTOS) as ProdutoId[]),
  "catalogo",
];

export function ehAlvoDeLink(valor: unknown): valor is AlvoDeLink {
  return typeof valor === "string" && (ALVOS_DE_LINK as readonly string[]).includes(valor);
}

const UTM = "utm_medium=invite_share&utm_source=revendedor";

export type ResultadoLink =
  | { ok: true; url: string }
  | { ok: false; erro: "produto_desconhecido" | "referrer_ausente" };

/**
 * Monta o link do alvo pedido.
 *
 * - `"catalogo"` quando o cliente ainda não decidiu: ele navega e escolhe.
 * - um `productId` quando já decidiu: cai direto no carrinho, que é o que
 *   converte melhor.
 *
 * Nunca lança: quem chama é a tool, e uma exceção aqui mataria o turno.
 */
export function montarLink(produto: unknown): ResultadoLink {
  if (!ehAlvoDeLink(produto)) return { ok: false, erro: "produto_desconhecido" };

  const referrer = process.env.TON_REFERRER?.trim();
  // Sem referrer o link até funciona, mas a indicação não é atribuída ao Pedro
  // — ou seja, a venda acontece e ele não ganha. Melhor não mandar nada.
  if (!referrer) return { ok: false, erro: "referrer_ausente" };

  if (produto === "catalogo") {
    return {
      ok: true,
      url: `https://ton.com.br/catalogo/?referrer=${referrer}&userAnticipation=0&${UTM}`,
    };
  }

  const { userTag } = PRODUTOS[produto];
  return {
    ok: true,
    url:
      `https://ton.com.br/checkout/cart/?productId=${produto}` +
      `&referrer=${referrer}&userAnticipation=0&userTag=${userTag}&${UTM}`,
  };
}
