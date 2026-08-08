import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/inbox")({
  component: LayoutInbox,
});

function LayoutInbox() {
  return (
    <div className="grid h-full grid-cols-[340px_1fr]">
      <aside className="overflow-y-auto border-r border-[var(--color-borda)]">
        <p className="p-4 text-[var(--color-suave)]">Lista de conversas (Task 6)</p>
      </aside>
      <section className="min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
