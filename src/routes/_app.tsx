import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { obterSessaoAtual, sair } from "@/lib/auth/auth.functions";
import { useConversas } from "@/components/crm/useConversas";
import { useTarefasAbertas } from "@/components/crm/useTarefasAbertas";

export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const usuario = await obterSessaoAtual();
    if (!usuario) {
      throw redirect({ to: "/login", search: { destino: location.href } });
    }
    return { usuario };
  },
  component: LayoutApp,
});

function LayoutApp() {
  const navegar = useNavigate();

  // As duas queries que alimentam os contadores são as MESMAS (chave e queryFn)
  // que a lista de conversas e a tela /tarefas usam — um cache só, números que
  // não têm como divergir do que está logo abaixo na tela.
  const { data: conversas = [] } = useConversas();
  const { data: tarefasAbertas = [] } = useTarefasAbertas();

  // Só conta o que está na janela de 50 conversas do inbox: é o mesmo conjunto
  // que o filtro "Atenção" da lista mostra, então o número bate com o que o
  // operador consegue clicar.
  const precisamAtencao = conversas.filter((lead: any) => lead.precisa_atencao).length;

  async function encerrar() {
    await sair();
    navegar({ to: "/login", search: { destino: "/inbox" } });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-4 border-b border-[var(--color-borda)] px-4 py-2">
        <strong>TON CRM</strong>
        <Link to="/inbox" className="text-[var(--color-suave)] hover:text-[var(--color-texto)]">
          Conversas
        </Link>
        {precisamAtencao > 0 && (
          <span className="rounded px-2 py-0.5 text-sm" style={{ background: "var(--color-alerta)" }}>
            {precisamAtencao} {precisamAtencao === 1 ? "precisa" : "precisam"} de atenção
          </span>
        )}
        <Link to="/tarefas" className="text-[var(--color-suave)] hover:text-[var(--color-texto)]">
          Tarefas{tarefasAbertas.length > 0 ? ` (${tarefasAbertas.length})` : ""}
        </Link>
        <button onClick={encerrar} className="ml-auto text-[var(--color-suave)]">
          Sair
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
