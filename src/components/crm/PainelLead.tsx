import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comSessao } from "@/lib/auth/sessao-expirada";
import { useState } from "react";
import { ESTAGIOS } from "@/lib/crm/estagios";
import {
  alternarNaoPerturbe,
  atualizarDadosDoLead,
  moverEstagioDoLead,
  obterLeadDoCrm,
  registrarNotaNoLead,
  resolverAtencao,
} from "@/lib/crm/crm.functions";
import { rotuloDeEstagio } from "./rotulos";
import { TarefasDoLead } from "./TarefasDoLead";

// Limites espelhados dos validators Zod em src/lib/crm/crm.functions.ts:
// `nome` e `maquina_interesse` são .max(120) (linhas 187-188) e a nota é
// .max(2000) (linha 204). Sem isso o Zod rejeita no servidor e o operador
// não vê nada — o texto excedente some sem aviso.
const LIMITE_NOME = 120;
const LIMITE_MAQUINA = 120;
const LIMITE_NOTA = 2000;

function mensagemDeErro(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

export function PainelLead({ leadId, conversaId }: { leadId: string; conversaId: string }) {
  const clienteQuery = useQueryClient();
  const [nota, setNota] = useState("");

  // Mesma queryKey e mesma server function da rota inbox.$conversaId — o
  // painel e o cabeçalho leem o mesmo cache, então invalidar (ou escrever
  // otimisticamente) aqui atualiza os dois.
  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => comSessao(obterLeadDoCrm({ data: { leadId } })),
    enabled: Boolean(leadId),
  });

  function recarregar() {
    clienteQuery.invalidateQueries({ queryKey: ["lead", leadId] });
    clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
  }

  const mudarEstagio = useMutation({
    // `moverEstagioDoLead` devolve `{ ok: mudou }` em vez de lançar. Sem
    // checar, a mutation "tem sucesso" com o estágio intacto e o otimismo
    // abaixo deixa o <select> exibindo um valor que o banco nunca aceitou —
    // a mesma falha silenciosa já fechada em `resolver`.
    //
    // Mas `ok:false` tem dois significados: lead inexistente E no-op quando
    // `de === para` (leads.server.ts:77 via camposDeTransicao). Só o primeiro
    // é falha. Comparar com o estágio atual separa os dois aqui, sem mexer em
    // `moverEstagio`, que a fatia 2 também usa.
    mutationFn: async (estagio: string) => {
      const eraOMesmo = lead?.estagio === estagio;
      const resultado = await comSessao(moverEstagioDoLead({ data: { leadId, estagio } }));
      if (!resultado?.ok && !eraOMesmo) {
        throw new Error("o servidor não aplicou a mudança de estágio");
      }
      return resultado;
    },
    // O <select> é controlado por `lead.estagio`. Sem escrever o valor novo
    // no cache ANTES da ida ao servidor, o React reconcilia o elemento com o
    // valor antigo assim que o evento de change termina e devolve o DOM ao
    // estágio anterior — o operador vê o dropdown "recusar" a escolha até a
    // resposta chegar. Escrevendo aqui, a fonte da verdade do componente já
    // é o valor novo no próprio ciclo do evento.
    onMutate: async (estagio: string) => {
      await clienteQuery.cancelQueries({ queryKey: ["lead", leadId] });
      const anterior = clienteQuery.getQueryData<any>(["lead", leadId]);
      clienteQuery.setQueryData<any>(["lead", leadId], (atual: any) =>
        atual ? { ...atual, estagio } : atual,
      );
      return { anterior };
    },
    onError: (_erro, _estagio, contexto) => {
      clienteQuery.setQueryData<any>(["lead", leadId], contexto?.anterior);
    },
    onSettled: recarregar,
  });
  const salvarCampo = useMutation({
    mutationFn: (campos: Record<string, unknown>) => comSessao(atualizarDadosDoLead({ data: { leadId, campos } })),
    onSuccess: recarregar,
  });
  const salvarNota = useMutation({
    mutationFn: () => comSessao(registrarNotaNoLead({ data: { leadId, texto: nota.trim() } })),
    onSuccess: () => {
      setNota("");
      recarregar();
    },
  });
  const resolver = useMutation({
    // resolverAtencao devolve { ok: false, erro } em vez de lançar — sem este
    // throw a mutation "tem sucesso" com a atenção intacta e a linha de erro
    // abaixo nunca apareceria.
    mutationFn: async () => {
      const resultado = await comSessao(resolverAtencao({ data: { leadId } }));
      if (!resultado.ok) throw new Error(resultado.erro ?? "falha ao resolver a atenção");
      return resultado;
    },
    onSuccess: recarregar,
  });
  const silenciar = useMutation({
    mutationFn: () => comSessao(alternarNaoPerturbe({ data: { leadId, conversaId, motivo: "marcado no inbox" } })),
    onSuccess: recarregar,
  });

  // Um único ponto de exibição para as cinco mutations do painel. A mais
  // recente ganha: o `submittedAt` de cada mutation é o instante do
  // `mutate()`, então a última ação do operador é a que ele vê comentada.
  //
  // O `.error` de uma useMutation NÃO é limpo pelo sucesso de outra. Filtrar
  // só por `.error` deixava o aviso grudado: uma falha ao mudar estágio ficava
  // na tela para sempre enquanto o operador salvava nome e nota com sucesso,
  // acusando de erro um estado que já tinha passado. Só conta o erro se
  // nenhuma mutation posterior teve sucesso.
  const mutations = [mudarEstagio, salvarCampo, salvarNota, resolver, silenciar];
  const ultimoSucessoEm = Math.max(
    0,
    ...mutations.filter((m) => m.isSuccess).map((m) => m.submittedAt ?? 0),
  );
  const erroDoPainel = mutations
    .filter((m) => m.error && (m.submittedAt ?? 0) >= ultimoSucessoEm)
    .sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))[0]?.error;

  if (!lead) {
    return <aside className="border-l border-[var(--color-borda)] p-4">Carregando…</aside>;
  }

  return (
    <aside className="flex flex-col gap-4 overflow-y-auto border-l border-[var(--color-borda)] p-4 text-sm">
      {lead.precisa_atencao && (
        <div className="rounded p-2" style={{ background: "var(--color-alerta)" }}>
          <p>A IA escalou esta conversa e parou de responder.</p>
          <button onClick={() => resolver.mutate()} className="mt-1 underline">
            Marcar como resolvido
          </button>
        </div>
      )}

      {erroDoPainel && (
        <p role="alert" className="rounded p-2" style={{ background: "var(--color-alerta)" }}>
          Não salvou: {mensagemDeErro(erroDoPainel)}
        </p>
      )}

      <label className="flex flex-col gap-1">
        Estágio
        <select
          value={lead.estagio ?? "novo"}
          onChange={(evento) => mudarEstagio.mutate(evento.target.value)}
          disabled={mudarEstagio.isPending}
          className="rounded bg-[var(--color-painel)] p-1 disabled:opacity-50"
        >
          {ESTAGIOS.map((estagio) => (
            <option key={estagio} value={estagio}>
              {rotuloDeEstagio(estagio)}
            </option>
          ))}
        </select>
      </label>

      {/* defaultValue + onBlur de propósito: campo não-controlado não é
          reescrito quando o recarregar() troca o objeto `lead`, então o que o
          operador está digitando não some no meio da digitação. Como o React
          não reescreve o campo, o .trim() é aplicado também ao DOM — senão o
          que fica na tela difere do que foi gravado. */}
      <label className="flex flex-col gap-1">
        Nome
        <input
          defaultValue={lead.nome ?? ""}
          maxLength={LIMITE_NOME}
          onBlur={(evento) => {
            const valor = evento.target.value.trim();
            evento.target.value = valor;
            salvarCampo.mutate({ nome: valor || null });
          }}
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        Máquina de interesse
        <input
          defaultValue={lead.maquina_interesse ?? ""}
          maxLength={LIMITE_MAQUINA}
          onBlur={(evento) => {
            const valor = evento.target.value.trim();
            evento.target.value = valor;
            salvarCampo.mutate({ maquina_interesse: valor || null });
          }}
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        Comissão estimada (R$)
        <input
          type="number"
          step="0.01"
          min="0"
          defaultValue={lead.comissao_estimada ?? ""}
          onBlur={(evento) =>
            salvarCampo.mutate({
              comissao_estimada: evento.target.value === "" ? null : Number(evento.target.value),
            })
          }
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      {lead.ad_source_id && (
        <div className="rounded bg-[var(--color-painel)] p-2">
          <strong>Veio de anúncio</strong>
          <p className="text-[var(--color-suave)]">{lead.ad_title ?? "sem título"}</p>
          <p className="text-xs text-[var(--color-suave)]">ID: {lead.ad_source_id}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <strong>Nota</strong>
        <textarea
          value={nota}
          onChange={(evento) => setNota(evento.target.value)}
          maxLength={LIMITE_NOTA}
          rows={2}
          className="rounded bg-[var(--color-painel)] p-1"
        />
        <button
          onClick={() => salvarNota.mutate()}
          disabled={!nota.trim() || salvarNota.isPending}
          className="self-start rounded bg-[var(--color-painel)] px-2 py-1 disabled:opacity-50"
        >
          Salvar nota
        </button>
      </div>

      <TarefasDoLead leadId={leadId} />

      {!lead.nao_perturbe && (
        <button
          onClick={() => silenciar.mutate()}
          className="self-start text-[var(--color-suave)] underline"
        >
          Marcar "não perturbe"
        </button>
      )}
      {lead.nao_perturbe && (
        <p className="text-[var(--color-suave)]">
          🔇 Não perturbe ativo. É permanente por conduta do programa — só é desfeito à mão no banco.
        </p>
      )}
    </aside>
  );
}
