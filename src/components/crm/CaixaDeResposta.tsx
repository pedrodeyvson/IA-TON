import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { responderNoInbox } from "@/lib/crm/crm.functions";
import { destinoSeguro } from "@/lib/auth/destino";
import {
  ehNaoAutenticado,
  guardarRascunho,
  lerRascunho,
  limparRascunho,
} from "@/lib/auth/sessao-expirada";

export function CaixaDeResposta({
  conversaId,
  leadId,
  iaAtiva,
  temTelefone,
}: {
  conversaId: string;
  leadId: string;
  iaAtiva: boolean;
  temTelefone: boolean;
}) {
  // O rascunho no sessionStorage é o que sobrevive a uma ida ao login: o
  // estado do React morre no recarregamento, o sessionStorage não.
  const [texto, setTexto] = useState(() => lerRascunho(conversaId));
  const [erro, setErro] = useState<string | null>(null);
  const clienteQuery = useQueryClient();
  const navegar = useNavigate();

  // O router reaproveita este componente ao trocar de conversa — o
  // inicializador do useState não roda de novo. Sem esta troca em tempo de
  // render, o texto da conversa anterior continuaria na caixa E o efeito
  // abaixo o gravaria sob a chave da conversa nova. É o padrão documentado do
  // React para estado derivado de prop, e não custa um render extra a mais.
  const [conversaDoTexto, setConversaDoTexto] = useState(conversaId);
  if (conversaDoTexto !== conversaId) {
    setConversaDoTexto(conversaId);
    setTexto(lerRascunho(conversaId));
    setErro(null);
  }

  useEffect(() => {
    guardarRascunho(conversaId, texto);
  }, [conversaId, texto]);

  /** O rascunho já está no sessionStorage; ao voltar para esta conversa, a
   *  caixa o recupera. Mesmo `?destino=` que o guard do `_app` usa. */
  function irParaLogin() {
    navegar({
      to: "/login",
      search: { destino: destinoSeguro(window.location.pathname + window.location.search) },
    });
  }

  const envio = useMutation({
    mutationFn: () => responderNoInbox({ data: { conversaId, leadId, texto: texto.trim() } }),
    onSuccess: (resultado) => {
      // O 401 do middleware volta pelo caminho de SUCESSO, não pelo de erro —
      // conferido no navegador com o cookie apagado. O handler do TanStack
      // devolve a Response de `exigirSessao` intacta, com `x-tss-raw: true`, e
      // o fetcher do cliente repassa Response crua em vez de lançar. Como
      // `Response.ok` é false num 401, sem esta checagem vindo ANTES o
      // operador só veria "Não foi possível enviar." e perderia o texto ao
      // recarregar.
      if (ehNaoAutenticado(resultado)) {
        irParaLogin();
        return;
      }
      if (!resultado.ok) {
        setErro(resultado.erro ?? "Não foi possível enviar.");
        return;
      }
      // Só limpa depois de confirmado: perder o texto digitado por causa de
      // uma falha de envio é o tipo de coisa que faz abandonar a ferramenta.
      setTexto("");
      limparRascunho(conversaId);
      setErro(null);
      clienteQuery.invalidateQueries({ queryKey: ["mensagens", conversaId] });
      clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
      clienteQuery.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onError: (erroDoEnvio) => {
      // O 401 não cai aqui na versão atual do TanStack Start (ver onSuccess),
      // mas cai se a Response for lançada em vez de devolvida — no SSR, ou se
      // o `x-tss-raw` mudar. Custa uma linha e evita mandar o operador para um
      // erro genérico quando a sessão é o problema.
      if (ehNaoAutenticado(erroDoEnvio)) {
        irParaLogin();
        return;
      }
      setErro("Não foi possível enviar.");
    },
  });

  if (!temTelefone) {
    return (
      <div className="border-t border-[var(--color-borda)] p-3 text-sm text-[var(--color-suave)]">
        Este lead chegou sem telefone real (identificador @lid). Não há para onde enviar
        mensagem — o histórico continua sendo registrado.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-borda)] p-3">
      {iaAtiva && (
        <p className="mb-1 text-xs text-[var(--color-suave)]">
          Ao responder, você assume a conversa e a IA para.
        </p>
      )}
      <textarea
        value={texto}
        onChange={(evento) => setTexto(evento.target.value)}
        onKeyDown={(evento) => {
          if (evento.key === "Enter" && !evento.shiftKey && texto.trim()) {
            evento.preventDefault();
            envio.mutate();
          }
        }}
        rows={3}
        placeholder="Escreva sua resposta… (Enter envia, Shift+Enter quebra linha)"
        className="w-full rounded bg-[var(--color-painel)] p-2"
      />
      {erro && <p className="text-sm text-red-400">{erro}</p>}
      <button
        onClick={() => envio.mutate()}
        disabled={!texto.trim() || envio.isPending}
        className="mt-1 rounded bg-[var(--color-ia)] px-3 py-1 disabled:opacity-50"
      >
        {envio.isPending ? "Enviando…" : "Enviar"}
      </button>
    </div>
  );
}
