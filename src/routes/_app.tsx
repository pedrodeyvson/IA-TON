import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { obterSessaoAtual, sair } from "@/lib/auth/auth.functions";

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
