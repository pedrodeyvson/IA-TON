import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { entrar } from "@/lib/auth/auth.functions";
import { destinoSeguro } from "@/lib/auth/destino";

export const Route = createFileRoute("/login")({
  validateSearch: (busca: Record<string, unknown>) => ({
    destino: destinoSeguro(busca.destino),
  }),
  component: TelaLogin,
});

function TelaLogin() {
  const navegar = useNavigate();
  const { destino } = useSearch({ from: "/login" });
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function submeter(evento: React.FormEvent) {
    evento.preventDefault();
    setEnviando(true);
    setErro(null);
    const resultado = await entrar({ data: { email, senha } });
    setEnviando(false);
    if (!resultado.ok) {
      setErro(resultado.erro ?? "Não foi possível entrar.");
      return;
    }
    navegar({ to: destino });
  }

  return (
    <main style={{ maxWidth: 320, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>TON CRM</h1>
      <form onSubmit={submeter}>
        <label>
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            required
            autoComplete="current-password"
            style={{ width: "100%" }}
          />
        </label>
        {erro && <p role="alert">{erro}</p>}
        <button type="submit" disabled={enviando}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
