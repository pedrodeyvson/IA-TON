import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

// Entrada de router exigida pelo @tanstack/start-plugin-core (resolveEntry
// com type "router entry", required: true). Sem este arquivo o dev server
// falha ao subir com "Could not resolve entry for router entry: router".
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
  });
}
