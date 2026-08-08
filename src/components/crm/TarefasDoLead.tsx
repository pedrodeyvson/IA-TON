import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  alternarTarefaDoCrm,
  criarTarefaDoCrm,
  excluirTarefaDoCrm,
  listarTarefasDoCrm,
} from "@/lib/crm/crm.functions";

// Espelha o .max(200) do validator de `criarTarefaDoCrm`
// (src/lib/crm/crm.functions.ts:245). Sem isso, colar um título longo é
// rejeitado no servidor sem nada aparecer na tela.
const LIMITE_TITULO = 200;

function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

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

  // Invalida a chave-prefixo ["tarefas"] de propósito: alcança a lista deste
  // lead e a de qualquer outra tela. A escrita otimista abaixo, ao contrário,
  // precisa da chave EXATA ["tarefas", leadId] — é ela que esta query lê.
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
    // O checkbox é controlado por `tarefa.concluida`. Sem gravar o valor novo
    // no cache antes da requisição, o React reconcilia o input com o valor
    // antigo ainda no ciclo do evento e o marcador volta sozinho até a
    // resposta chegar. Escrevendo aqui, o valor que controla o input já é o
    // que o operador acabou de escolher.
    onMutate: async ({ tarefaId, concluida }) => {
      await clienteQuery.cancelQueries({ queryKey: ["tarefas", leadId] });
      const anterior = clienteQuery.getQueryData<any[]>(["tarefas", leadId]);
      clienteQuery.setQueryData<any[]>(["tarefas", leadId], (atual) =>
        atual?.map((tarefa: any) => (tarefa.id === tarefaId ? { ...tarefa, concluida } : tarefa)),
      );
      return { anterior };
    },
    onError: (_erro, _variaveis, contexto) => {
      clienteQuery.setQueryData<any[]>(["tarefas", leadId], contexto?.anterior);
    },
    onSettled: recarregar,
  });
  const excluir = useMutation({
    mutationFn: (tarefaId: string) => excluirTarefaDoCrm({ data: { tarefaId } }),
    onSuccess: recarregar,
  });

  // O campo só é limpo no onSuccess, então enquanto a criação está no ar o
  // título continua na tela — um segundo clique criaria a mesma tarefa de novo.
  const podeCriar = Boolean(titulo.trim()) && !criar.isPending;

  // Ponto único de exibição das três mutations de tarefa; a mais recente ganha.
  const erroDasTarefas = [criar, alternar, excluir]
    .filter((mutation) => mutation.error)
    .sort((a, b) => b.submittedAt - a.submittedAt)[0]?.error;

  return (
    <div className="flex flex-col gap-1">
      <strong>Tarefas</strong>
      {erroDasTarefas && (
        <p role="alert" className="rounded p-2" style={{ background: "var(--color-alerta)" }}>
          Não salvou: {mensagemDeErro(erroDasTarefas)}
        </p>
      )}
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
          maxLength={LIMITE_TITULO}
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
