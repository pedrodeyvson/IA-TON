import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { devolverParaIa, obterLeadDoCrm, pausarIaNaConversa } from "@/lib/crm/crm.functions";
import { CaixaDeResposta } from "@/components/crm/CaixaDeResposta";
import { Historico } from "@/components/crm/Historico";
import { PainelLead } from "@/components/crm/PainelLead";
import { useConversas } from "@/components/crm/useConversas";

export const Route = createFileRoute("/_app/inbox/$conversaId")({
  validateSearch: (busca: Record<string, unknown>) => ({
    leadId: String(busca.leadId ?? ""),
  }),
  component: TelaConversa,
});

function TelaConversa() {
  const { conversaId } = Route.useParams();
  const { leadId } = Route.useSearch();
  const clienteQuery = useQueryClient();

  const { data: lead } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => obterLeadDoCrm({ data: { leadId } }),
    enabled: Boolean(leadId),
  });

  // O estado da IA vive na conversa, que já vem na listagem do inbox —
  // reaproveita o cache do hook em vez de uma consulta só para isso.
  const { data: conversas = [] } = useConversas();
  const conversa = conversas
    .flatMap((l: any) => l.conversas ?? [])
    .find((c: any) => c.id === conversaId);
  const iaAtiva = !conversa?.pausada_pela_ia;

  const alternarIa = useMutation({
    mutationFn: () =>
      iaAtiva ? pausarIaNaConversa({ data: { conversaId } }) : devolverParaIa({ data: { conversaId } }),
    onSuccess: () => clienteQuery.invalidateQueries({ queryKey: ["conversas"] }),
  });

  return (
    <div className="grid h-full grid-cols-[1fr_340px]">
      <div className="flex min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--color-borda)] px-4 py-2">
          <strong>{lead?.nome ?? lead?.telefone ?? "Conversa"}</strong>
          <span className="text-sm text-[var(--color-suave)]">{lead?.telefone ?? "sem telefone"}</span>
          <span className="ml-auto text-sm text-[var(--color-suave)]">
            {iaAtiva ? "IA respondendo" : "você assumiu"}
          </span>
          <button
            onClick={() => alternarIa.mutate()}
            className="rounded bg-[var(--color-painel)] px-3 py-1 text-sm"
          >
            {iaAtiva ? "Assumir" : "Devolver para a IA"}
          </button>
        </header>

        <Historico conversaId={conversaId} />

        <CaixaDeResposta
          conversaId={conversaId}
          leadId={leadId}
          iaAtiva={iaAtiva}
          temTelefone={Boolean(lead?.telefone)}
        />
      </div>

      <PainelLead leadId={leadId} conversaId={conversaId} />
    </div>
  );
}
