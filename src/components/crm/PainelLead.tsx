import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function PainelLead({ leadId, conversaId }: { leadId: string; conversaId: string }) {
  const clienteQuery = useQueryClient();
  const [nota, setNota] = useState("");

  // Mesma queryKey e mesma server function da rota inbox.$conversaId — o
  // painel e o cabeçalho leem o mesmo cache, então invalidar aqui atualiza
  // os dois.
  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => obterLeadDoCrm({ data: { leadId } }),
    enabled: Boolean(leadId),
  });

  function recarregar() {
    clienteQuery.invalidateQueries({ queryKey: ["lead", leadId] });
    clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
  }

  const mudarEstagio = useMutation({
    mutationFn: (estagio: string) => moverEstagioDoLead({ data: { leadId, estagio } }),
    onSuccess: recarregar,
  });
  const salvarCampo = useMutation({
    mutationFn: (campos: Record<string, unknown>) => atualizarDadosDoLead({ data: { leadId, campos } }),
    onSuccess: recarregar,
  });
  const salvarNota = useMutation({
    mutationFn: () => registrarNotaNoLead({ data: { leadId, texto: nota.trim() } }),
    onSuccess: () => {
      setNota("");
      recarregar();
    },
  });
  const resolver = useMutation({
    mutationFn: () => resolverAtencao({ data: { leadId } }),
    onSuccess: recarregar,
  });
  const silenciar = useMutation({
    mutationFn: () => alternarNaoPerturbe({ data: { leadId, conversaId, motivo: "marcado no inbox" } }),
    onSuccess: recarregar,
  });

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

      <label className="flex flex-col gap-1">
        Estágio
        <select
          value={lead.estagio ?? "novo"}
          onChange={(evento) => mudarEstagio.mutate(evento.target.value)}
          className="rounded bg-[var(--color-painel)] p-1"
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
          operador está digitando não some no meio da digitação. */}
      <label className="flex flex-col gap-1">
        Nome
        <input
          defaultValue={lead.nome ?? ""}
          onBlur={(evento) => salvarCampo.mutate({ nome: evento.target.value || null })}
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        Máquina de interesse
        <input
          defaultValue={lead.maquina_interesse ?? ""}
          onBlur={(evento) => salvarCampo.mutate({ maquina_interesse: evento.target.value || null })}
          className="rounded bg-[var(--color-painel)] p-1"
        />
      </label>

      <label className="flex flex-col gap-1">
        Comissão estimada (R$)
        <input
          type="number"
          step="0.01"
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
