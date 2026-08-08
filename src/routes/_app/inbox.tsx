import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ListaConversas } from "@/components/crm/ListaConversas";

export const Route = createFileRoute("/_app/inbox")({
  component: LayoutInbox,
});

function LayoutInbox() {
  return (
    // `min-h-0` nos dois itens do grid é o que segura a altura. Item de grid
    // tem `min-height: auto` por padrão: sem isso ele estica para caber o
    // conteúdo, a linha cresce junto, e quem passa a rolar é a PÁGINA inteira
    // em vez do histórico — quanto mais mensagens, pior. O `overflow-y-auto`
    // do Historico não resolve sozinho se um ancestral não estiver capado.
    <div className="grid h-full min-h-0 grid-cols-[340px_1fr]">
      <aside className="min-h-0 overflow-y-auto border-r border-[var(--color-borda)]">
        <ListaConversas />
      </aside>
      <section className="min-h-0 min-w-0 overflow-hidden">
        <Outlet />
      </section>
    </div>
  );
}
