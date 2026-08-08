// Classifica um erro de ENVIO da uazapi: falha do DESTINATÁRIO (bloqueou o
// número, número não existe no WhatsApp) vs falha TRANSITÓRIA (rede, rate
// limit, timeout, instabilidade do provedor). Puro — só olha o texto do erro
// que `client.server.ts` já lançou (`UAZAPI ${status}: ${corpo}`).
//
// Fonte do padrão HTTP 500 + "The WhatsApp server rejected this message":
// spec da fatia 6 (`docs/superpowers/specs/2026-08-08-fatia-6-revisao-comercial-notas.md`,
// §5), que documenta o incidente real do CPI em 31/07/2026 — três leads
// bloquearam o número e o worker bateu neles de 20 em 20 min por mais de 6h
// (42 tentativas, zero entregues) antes de alguém notar. O CPI e este projeto
// usam a MESMA instância/vendor uazapi (`conversas.server.ts` documenta:
// "A instância de WhatsApp é compartilhada com outro projeto do dono"), então
// o formato de erro observado lá se aplica aqui.
//
// Não foi possível confirmar com uma chamada real nesta task: o ambiente de
// execução bloqueia chamadas de rede de saída para a uazapi (classificador de
// sandbox recusou o `curl` de diagnóstico), e a tabela `mensagens` de
// produção não tem nenhuma linha `falhou` para minerar (diferente do caso do
// `page_id` do CAPI, que tinha 26 tentativas reais já gravadas em
// `eventos_capi`). Ver o relatório desta task para o registro completo da
// tentativa.
const PADRAO_REJEICAO_DESTINATARIO = /rejected this message/i;
const PADRAO_STATUS_500 = /UAZAPI 500:/;

/**
 * `true` só quando o erro bate os DOIS sinais documentados (status 500 E a
 * mensagem específica de rejeição) — exigir os dois em vez de só o status
 * evita classificar um 500 genérico (bug transitório do provedor) como
 * bloqueio do destinatário, o que pararia de tentar um lead que só teve azar
 * com uma instabilidade passageira.
 */
export function ehFalhaDoDestinatario(erro: string | null | undefined): boolean {
  if (!erro) return false;
  return PADRAO_STATUS_500.test(erro) && PADRAO_REJEICAO_DESTINATARIO.test(erro);
}
