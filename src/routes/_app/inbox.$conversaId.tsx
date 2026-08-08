import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comSessao } from "@/lib/auth/sessao-expirada";
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
    queryFn: () => comSessao(obterLeadDoCrm({ data: { leadId } })),
    enabled: Boolean(leadId),
  });

  // Consulta dedicada — a listagem do inbox (useConversas) só cobre as 50
  // conversas mais recentes; fora dessa janela ela devolveria `undefined`,
  // e `!undefined?.pausada_pela_ia` vira `true`, afirmando "IA respondendo"
  // pra uma conversa que o operador já assumiu.
  const { data: estadoConversa } = useQuery({
    queryKey: ["conversa", conversaId],
    queryFn: () => comSessao(obterEstadoDaConversa({ data: { conversaId } })),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const carregandoEstado = estadoConversa === undefined;
  // Enquanto não sabemos, assume IA ativa — e não o contrário. O estado
  // normal de uma conversa é a IA respondendo; pausada é a exceção, criada
  // por uma ação explícita do operador. Errar para "ativa" só mostra o
  // aviso de assumir a mais, o que é inofensivo (responder pausa a IA de
  // qualquer forma). Errar para "assumida" esconderia o aviso justo na
  // janela em que o operador digita a primeira resposta — quando ele mais
  // precisa dele.
  const iaAtiva = estadoConversa ? !estadoConversa.pausadaPelaIa : true;

  const alternarIa = useMutation({
    mutationFn: () =>
      iaAtiva ? pausarIaNaConversa({ data: { conversaId } }) : devolverParaIa({ data: { conversaId } }),
    onSuccess: () => {
      clienteQuery.invalidateQueries({ queryKey: ["conversa", conversaId] });
      clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
    },
  });

  return (
    // Mesma armadilha do grid de `_app/inbox.tsx`: sem `min-h-0` os itens
    // esticam com o conteúdo e o histórico deixa de ser o que rola.
    <div className="grid h-full min-h-0 grid-cols-[1fr_340px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--color-borda)] px-4 py-2">
          <strong>{lead?.nome ?? lead?.telefone ?? "Conversa"}</strong>
          <span className="text-sm text-[var(--color-suave)]">{lead?.telefone ?? "sem telefone"}</span>
          <span className="ml-auto text-sm text-[var(--color-suave)]">
            {iaAtiva ? "IA respondendo" : "você assumiu"}
          </span>
          {/* O botão fica fora do ar até o estado chegar: ele age sobre o
              controle da conversa, e agir a partir de um palpite é diferente
              de exibir um aviso a mais. */}
          <button
            onClick={() => alternarIa.mutate()}
            disabled={carregandoEstado}
            className="rounded bg-[var(--color-painel)] px-3 py-1 text-sm disabled:opacity-50"
          >
            {carregandoEstado ? "…" : iaAtiva ? "Assumir" : "Devolver para a IA"}
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
