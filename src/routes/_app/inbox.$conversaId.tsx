import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  devolverParaIa,
  obterEstadoDaConversa,
  obterLeadDoCrm,
  pausarIaNaConversa,
} from "@/lib/crm/crm.functions";
import { CaixaDeResposta } from "@/components/crm/CaixaDeResposta";
import { Historico } from "@/components/crm/Historico";
import { PainelLead } from "@/components/crm/PainelLead";

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

  // Consulta dedicada — a listagem do inbox (useConversas) só cobre as 50
  // conversas mais recentes; fora dessa janela ela devolveria `undefined`,
  // e `!undefined?.pausada_pela_ia` vira `true`, afirmando "IA respondendo"
  // pra uma conversa que o operador já assumiu.
  const { data: estadoConversa } = useQuery({
    queryKey: ["conversa", conversaId],
    queryFn: () => obterEstadoDaConversa({ data: { conversaId } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  // Enquanto carrega (ou se a conversa não existir), o lado conservador é
  // "a IA não está ativa": nunca afirma controle que ainda não verificou.
  const iaAtiva = estadoConversa ? !estadoConversa.pausadaPelaIa : false;

  const alternarIa = useMutation({
    mutationFn: () =>
      iaAtiva ? pausarIaNaConversa({ data: { conversaId } }) : devolverParaIa({ data: { conversaId } }),
    onSuccess: () => {
      clienteQuery.invalidateQueries({ queryKey: ["conversa", conversaId] });
      clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
    },
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
