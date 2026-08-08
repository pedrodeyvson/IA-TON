import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { resumoDaLinha, rotuloDeEstagio } from "./rotulos";
import { useConversas } from "./useConversas";

type Filtro = "todas" | "atencao" | "assumidas";

export function ListaConversas() {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const { conversaId } = useParams({ strict: false }) as { conversaId?: string };

  const { data: conversas = [], isLoading } = useConversas();

  const visiveis = conversas.filter((c: any) => {
    if (filtro === "atencao") return c.precisa_atencao;
    if (filtro === "assumidas") return resumoDaLinha(c).assumida;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 border-b border-[var(--color-borda)] p-2 text-sm">
        {(
          [
            ["todas", "Todas"],
            ["atencao", "Atenção"],
            ["assumidas", "Você assumiu"],
          ] as Array<[Filtro, string]>
        ).map(([valor, texto]) => (
          <button
            key={valor}
            onClick={() => setFiltro(valor)}
            className={
              filtro === valor
                ? "rounded bg-[var(--color-painel)] px-2 py-1"
                : "px-2 py-1 text-[var(--color-suave)]"
            }
          >
            {texto}
          </button>
        ))}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <li className="p-4 text-[var(--color-suave)]">Carregando…</li>}
        {!isLoading && visiveis.length === 0 && (
          <li className="p-4 text-[var(--color-suave)]">Nenhuma conversa neste filtro.</li>
        )}
        {visiveis.map((lead: any) => {
          const { titulo, assumida } = resumoDaLinha(lead);
          const conversa = lead.conversas?.[0];
          const selecionada = conversa?.id === conversaId;
          return (
            <li key={lead.id}>
              <Link
                to="/inbox/$conversaId"
                params={{ conversaId: conversa?.id ?? "" }}
                search={{ leadId: lead.id }}
                disabled={!conversa?.id}
                className={`block border-b border-[var(--color-borda)] p-3 ${
                  selecionada ? "bg-[var(--color-painel)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{titulo}</span>
                  {lead.precisa_atencao && <span title="Precisa de atenção">⚠️</span>}
                  {lead.nao_perturbe && <span title="Não perturbe">🔇</span>}
                  {lead.nao_lidas > 0 && (
                    <span className="ml-auto rounded-full bg-[var(--color-ia)] px-2 text-xs">
                      {lead.nao_lidas}
                    </span>
                  )}
                </div>
                <p className="truncate text-sm text-[var(--color-suave)]">
                  {lead.ultima_mensagem_preview ?? "—"}
                </p>
                <div className="flex gap-2 text-xs text-[var(--color-suave)]">
                  <span>{rotuloDeEstagio(lead.estagio ?? "")}</span>
                  <span>·</span>
                  <span>{assumida ? "você assumiu" : "IA respondendo"}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
