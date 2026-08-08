import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import estilos from "../styles.css?url";

function criarClienteQuery() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // O inbox é o único consumidor e define o próprio refetchInterval.
        // Sem retry infinito: um 401 tem que chegar rápido na tela.
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}

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
  // Dentro do componente, não no topo do módulo: o servidor é um processo Node
  // persistente, então um client de módulo seria UM cache para todos os
  // requests — o SSR de um usuário passaria a enxergar dados cacheados no
  // request de outro. O useState com inicializador cria um por render de
  // servidor e mantém o mesmo no cliente entre renders.
  const [clienteQuery] = useState(criarClienteQuery);

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
