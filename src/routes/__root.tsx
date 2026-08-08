import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import estilos from "../styles.css?url";

const clienteQuery = new QueryClient({
  defaultOptions: {
    queries: {
      // O inbox é o único consumidor e define o próprio refetchInterval.
      // Sem retry infinito: um 401 tem que chegar rápido na tela.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "TON-CRM-IA" },
    ],
    links: [{ rel: "stylesheet", href: estilos }],
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
        <QueryClientProvider client={clienteQuery}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
