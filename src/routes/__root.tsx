import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";

// Casca mínima da aplicação. Ainda não há front-end de verdade — isso vem em
// fatias futuras. Este root route só existe para o TanStack Start ter uma
// árvore de rotas válida e o SSR conseguir montar <head>/<body>.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TON-CRM-IA" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
