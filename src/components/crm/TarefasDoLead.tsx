import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  alternarTarefaDoCrm,
  criarTarefaDoCrm,
  excluirTarefaDoCrm,
  listarTarefasDoCrm,
} from "@/lib/crm/crm.functions";

export function TarefasDoLead({ leadId }: { leadId: string }) {
  const clienteQuery = useQueryClient();
  const [titulo, setTitulo] = useState("");

  const { data: tarefas = [] } = useQuery({
    queryKey: ["tarefas", leadId],
    // apenasAbertas: false — no painel do lead as concluídas também aparecem,
    // riscadas, para dar contexto do que já foi feito com ele.
    queryFn: () => listarTarefasDoCrm({ data: { apenasAbertas: false, leadId } }),
    enabled: Boolean(leadId),
  });

  function recarregar() {
    clienteQuery.invalidateQueries({ queryKey: ["tarefas"] });
  }

  const criar = useMutation({
    mutationFn: () => criarTarefaDoCrm({ data: { leadId, titulo: titulo.trim() } }),
    onSuccess: () => {
      setTitulo("");
      recarregar();
    },
  });
  const alternar = useMutation({
    mutationFn: ({ tarefaId, concluida }: { tarefaId: string; concluida: boolean }) =>
      alternarTarefaDoCrm({ data: { tarefaId, concluida } }),
    onSuccess: recarregar,
  });
  const excluir = useMutation({
    mutationFn: (tarefaId: string) => excluirTarefaDoCrm({ data: { tarefaId } }),
    onSuccess: recarregar,
  });

  // O campo só é limpo no onSuccess, então enquanto a criação está no ar o
  // título continua na tela — um segundo clique criaria a mesma tarefa de novo.
  const podeCriar = Boolean(titulo.trim()) && !criar.isPending;

  return (
    <div className="flex flex-col gap-1">
      <strong>Tarefas</strong>
      {tarefas.map((tarefa: any) => (
        <div key={tarefa.id} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={tarefa.concluida}
            onChange={(evento) =>
              alternar.mutate({ tarefaId: tarefa.id, concluida: evento.target.checked })
            }
          />
          <span className={tarefa.concluida ? "line-through opacity-60" : ""}>{tarefa.titulo}</span>
          <button onClick={() => excluir.mutate(tarefa.id)} className="ml-auto opacity-60">
            ✕
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <input
          value={titulo}
          onChange={(evento) => setTitulo(evento.target.value)}
          placeholder="Nova tarefa"
          className="flex-1 rounded bg-[var(--color-painel)] p-1"
        />
        <button
          onClick={() => criar.mutate()}
          disabled={!podeCriar}
          className="rounded bg-[var(--color-painel)] px-2 disabled:opacity-50"
        >
          +
        </button>
      </div>
    </div>
  );
}
