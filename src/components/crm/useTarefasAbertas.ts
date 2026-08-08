import { useQuery } from "@tanstack/react-query";
import { listarTarefasDoCrm } from "@/lib/crm/crm.functions";

/**
 * Chave EXATA da fila de tarefas abertas.
 *
 * A tela `/tarefas` e o contador da barra superior leem o MESMO número. Se cada
 * uma declarasse a própria `useQuery`, bastaria um `apenasAbertas` divergente
 * ou um `["tarefa", ...]` no singular para virarem dois caches distintos — e o
 * contador passaria a discordar da lista logo abaixo dele. Por isso a query
 * mora aqui, num lugar só.
 *
 * É prefixada por `["tarefas"]` de propósito: o `invalidateQueries({ queryKey:
 * ["tarefas"] })` do `TarefasDoLead` (src/components/crm/TarefasDoLead.tsx:36)
 * casa por prefixo e alcança esta chave. Criar uma tarefa no painel do lead
 * atualiza o contador da barra sem nenhum aviso extra.
 */
export const CHAVE_TAREFAS_ABERTAS: string[] = ["tarefas", "abertas"];

/** A fila de tarefas abertas, compartilhada pela tela e pelo contador da barra.
 *  Mesmo polling de 5s do `useConversas`: um usuário só, custo irrelevante. */
export function useTarefasAbertas() {
  return useQuery({
    queryKey: CHAVE_TAREFAS_ABERTAS,
    queryFn: () => listarTarefasDoCrm({ data: { apenasAbertas: true } }),
    refetchInterval: 5000,
    // Aba escondida não precisa acordar o banco a noite inteira.
    refetchIntervalInBackground: false,
  });
}
