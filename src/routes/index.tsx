import { createFileRoute, redirect } from "@tanstack/react-router";

// "/" nunca teve tela própria — sobrou da época em que este projeto era só
// API (antes da Fatia 4 existir). Sem redirecionar, quem abre a raiz do
// domínio via em branco: só um <p> sem layout, sem CSS carregado. /_app já
// redireciona pra /login quando não há sessão, então cair em /inbox aqui
// resolve os dois casos (autenticado vê o inbox, anônimo vê o login).
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox" });
  },
});
