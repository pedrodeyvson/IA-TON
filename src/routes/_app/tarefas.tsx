import { useMutation, useQueryClient } from "@tanstack/react-query";
import { comSessao } from "@/lib/auth/sessao-expirada";
import { createFileRoute, Link } from "@tanstack/react-router";
import { alternarTarefaDoCrm } from "@/lib/crm/crm.functions";
import { conversaEmbutida, resumoDaLinha } from "@/components/crm/rotulos";
import { useConversas } from "@/components/crm/useConversas";
import { CHAVE_TAREFAS_ABERTAS, useTarefasAbertas } from "@/components/crm/useTarefasAbertas";

export const Route = createFileRoute("/_app/tarefas")({
  component: TelaTarefas,
});

function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

/** O que a tela consegue dizer sobre o lead dono da tarefa. */
type DonoDaTarefa = {
  conversaId?: string;
  /** `null` quando o lead não está na janela do inbox — a tela mostra isso
   *  explicitamente em vez de fingir um nome. */
  titulo: string | null;
};

function TelaTarefas() {
  const clienteQuery = useQueryClient();

  const { data: tarefas = [] } = useTarefasAbertas();

  // Para linkar cada tarefa à conversa do lead — a listagem do inbox já traz
  // esse mapeamento e está em cache. `isPending` importa: enquanto ela não
  // chega, NENHUM lead é encontrado, e sem essa distinção a tela acusaria
  // "fora das conversas recentes" para todo mundo no primeiro render.
  const { data: conversas = [], isPending: carregandoConversas } = useConversas();

  const concluir = useMutation({
    mutationFn: (tarefaId: string) => comSessao(alternarTarefaDoCrm({ data: { tarefaId, concluida: true } })),
    // Sem otimismo a linha só sumiria no refetch seguinte, e o checkbox —
    // controlado por `checked={false}` — seria restaurado para desmarcado pelo
    // próprio React ainda dentro do evento. Removendo a tarefa do cache aqui, a
    // linha sai da tela no instante do clique. Mesmo padrão de
    // `src/components/crm/TarefasDoLead.tsx:54-65`.
    onMutate: async (tarefaId: string) => {
      await clienteQuery.cancelQueries({ queryKey: CHAVE_TAREFAS_ABERTAS });
      const anterior = clienteQuery.getQueryData<any[]>(CHAVE_TAREFAS_ABERTAS);
      clienteQuery.setQueryData<any[]>(CHAVE_TAREFAS_ABERTAS, (atual) =>
        atual?.filter((tarefa: any) => tarefa.id !== tarefaId),
      );
      return { anterior };
    },
    onError: (_erro, _tarefaId, contexto) => {
      clienteQuery.setQueryData<any[]>(CHAVE_TAREFAS_ABERTAS, contexto?.anterior);
    },
    // Prefixo `["tarefas"]`: alcança esta fila e a lista do painel do lead.
    // No sucesso confirma a remoção; no erro, refaz a lista por cima do
    // rollback — se o banco não tiver mudado, a tarefa reaparece.
    onSettled: () => clienteQuery.invalidateQueries({ queryKey: ["tarefas"] }),
  });

  function donoDaTarefa(leadId: string): DonoDaTarefa {
    const lead = conversas.find((linha: any) => linha.id === leadId);
    // Um lead fora das 50 conversas mais recentes (o teto de `listarConversas`,
    // src/lib/crm/conversas.server.ts:222) simplesmente não está aqui. A tarefa
    // continua listável e concluível — só o atalho para a conversa some, porque
    // não temos o `conversaId` para montá-lo.
    if (!lead) return { titulo: null };
    // `conversaEmbutida` e não `lead.conversas?.[0]`: o embed do PostgREST vem
    // como OBJETO (conversas.lead_id é UNIQUE), e o índice [0] dava undefined.
    return { conversaId: conversaEmbutida(lead)?.id, titulo: resumoDaLinha(lead).titulo };
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-medium">Tarefas abertas</h1>

      {concluir.error && (
        <p role="alert" className="mb-3 rounded p-2" style={{ background: "var(--color-alerta)" }}>
          Não concluiu: {mensagemDeErro(concluir.error)}
        </p>
      )}

      {tarefas.length === 0 && <p className="text-[var(--color-suave)]">Nada pendente.</p>}

      <ul className="flex flex-col gap-2">
        {tarefas.map((tarefa: any) => {
          const { conversaId, titulo } = donoDaTarefa(tarefa.lead_id);
          return (
            <li
              key={tarefa.id}
              className="flex items-center gap-3 rounded border border-[var(--color-borda)] p-3"
            >
              <input
                type="checkbox"
                checked={false}
                aria-label={`Concluir: ${tarefa.titulo}`}
                onChange={() => concluir.mutate(tarefa.id)}
              />
              <div className="min-w-0">
                <p className="truncate">{tarefa.titulo}</p>
                <p className="text-xs text-[var(--color-suave)]">
                  {titulo ?? (carregandoConversas ? "carregando o lead…" : "lead fora das 50 conversas mais recentes")}
                  {tarefa.prazo
                    ? ` · vence ${new Date(tarefa.prazo).toLocaleDateString("pt-BR")}`
                    : ""}
                </p>
              </div>
              {conversaId && (
                <Link
                  to="/inbox/$conversaId"
                  params={{ conversaId }}
                  search={{ leadId: tarefa.lead_id }}
                  className="ml-auto shrink-0 underline"
                >
                  Abrir conversa
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
