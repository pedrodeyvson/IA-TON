import { createFileRoute } from "@tanstack/react-router";

// Esqueleto: a Task 10 preenche o corpo. Existe desde já porque o Link da
// lista é tipado contra a árvore de rotas gerada — sem o arquivo, apontar
// para cá não compila. A assinatura de busca já é a definitiva.
export const Route = createFileRoute("/_app/inbox/$conversaId")({
  validateSearch: (busca: Record<string, unknown>) => ({
    leadId: String(busca.leadId ?? ""),
  }),
  component: () => null,
});
