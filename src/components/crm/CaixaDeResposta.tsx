import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { responderNoInbox } from "@/lib/crm/crm.functions";

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
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const clienteQuery = useQueryClient();

  const envio = useMutation({
    mutationFn: () => responderNoInbox({ data: { conversaId, leadId, texto: texto.trim() } }),
    onSuccess: (resultado) => {
      if (!resultado.ok) {
        setErro(resultado.erro ?? "Não foi possível enviar.");
        return;
      }
      // Só limpa depois de confirmado: perder o texto digitado por causa de
      // uma falha de envio é o tipo de coisa que faz abandonar a ferramenta.
      setTexto("");
      setErro(null);
      clienteQuery.invalidateQueries({ queryKey: ["mensagens", conversaId] });
      clienteQuery.invalidateQueries({ queryKey: ["conversas"] });
      clienteQuery.invalidateQueries({ queryKey: ["lead", leadId] });
    },
    onError: () => setErro("Não foi possível enviar."),
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
