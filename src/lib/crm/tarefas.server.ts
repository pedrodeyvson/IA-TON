// Lembretes manuais do Pedro. Molde do crm_tasks do CPI, sem multi-tenancy
// (uso individual) e sem responsavel_id (só existe um usuário).
// A IA nunca escreve aqui — ela escala via precisa_atencao, não criando tarefa.

export type NovaTarefa = {
  leadId: string;
  titulo: string;
  descricao?: string | null;
  prazo?: string | null;
};

export async function criarTarefa(admin: any, nova: NovaTarefa): Promise<any> {
  const titulo = nova.titulo?.trim();
  if (!titulo) throw new Error("título da tarefa é obrigatório");

  const { data, error } = await admin
    .from("tarefas")
    .insert({
      lead_id: nova.leadId,
      titulo,
      descricao: nova.descricao ?? null,
      prazo: nova.prazo ?? null,
      concluida: false,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function listarTarefas(
  admin: any,
  filtro: { leadId?: string; concluida?: boolean } = {},
): Promise<any[]> {
  let consulta = admin.from("tarefas").select("*");
  if (filtro.leadId) consulta = consulta.eq("lead_id", filtro.leadId);
  if (filtro.concluida !== undefined) consulta = consulta.eq("concluida", filtro.concluida);
  const { data } = await consulta.order("prazo", { ascending: true });
  return data ?? [];
}

/**
 * LANÇA em falha de banco, igual `criarTarefa`.
 *
 * Antes o `error` era descartado e `alternarTarefaDoCrm` devolvia `{ ok: true }`
 * fixo (src/lib/crm/crm.functions.ts:266) — a tela riscava/removia a tarefa e o
 * banco continuava intacto. Como o retorno é uma constante, não há o que a UI
 * possa conferir: o único ponto capaz de distinguir sucesso de falha é aqui.
 */
export async function alternarTarefa(
  admin: any,
  tarefaId: string,
  concluida: boolean,
): Promise<void> {
  const { error } = await admin
    .from("tarefas")
    .update({
      concluida,
      concluida_em: concluida ? new Date().toISOString() : null,
      atualizado_em: new Date().toISOString(),
    })
    .eq("id", tarefaId);

  if (error) throw new Error(error.message);
}

/**
 * Mesmo defeito que `alternarTarefa` tinha: `excluirTarefaDoCrm` devolve
 * `{ ok: true }` constante, então descartar o `error` aqui deixava a UI sem
 * nada para conferir. A tarefa "apagada" reaparecia no refetch seguinte e a
 * linha de erro do TarefasDoLead nunca acendia.
 */
export async function excluirTarefa(admin: any, tarefaId: string): Promise<void> {
  const { error } = await admin.from("tarefas").delete().eq("id", tarefaId);
  if (error) throw new Error(error.message);
}
