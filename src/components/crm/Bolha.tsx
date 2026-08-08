import { useQuery } from "@tanstack/react-query";
import { obterUrlDeMidia } from "@/lib/crm/crm.functions";

/** Três aparências, não duas: confundir IA com humano faz o Pedro repetir ou
 *  contradizer o que a Mika já disse. */
const FUNDO: Record<string, string> = {
  lead: "var(--color-lead)",
  ia: "var(--color-ia)",
  humano: "var(--color-humano)",
};

export function Bolha({ mensagem, aoReenviar }: { mensagem: any; aoReenviar: (id: string) => void }) {
  const daCasa = mensagem.remetente !== "lead";
  const temMidia = Boolean(mensagem.media_path);

  const { data: midia } = useQuery({
    queryKey: ["midia", mensagem.id],
    queryFn: () => obterUrlDeMidia({ data: { mensagemId: mensagem.id } }),
    enabled: temMidia,
    // A URL assinada vale 5 min; renova com folga antes de expirar.
    staleTime: 4 * 60 * 1000,
  });

  return (
    <div className={`flex ${daCasa ? "justify-end" : "justify-start"} px-4 py-1`}>
      <div
        className="max-w-[70%] rounded-lg px-3 py-2"
        style={{ background: FUNDO[mensagem.remetente] ?? "var(--color-lead)" }}
      >
        <div className="mb-1 text-xs text-[var(--color-suave)]">
          {mensagem.remetente === "lead" ? "Cliente" : mensagem.remetente === "ia" ? "Mika" : "Você"}
        </div>

        {mensagem.tipo === "imagem" && midia?.url && (
          <a href={midia.url} target="_blank" rel="noreferrer">
            <img src={midia.url} alt="Imagem enviada" className="max-h-64 rounded" />
          </a>
        )}

        {mensagem.tipo === "audio" && (
          <div>
            {midia?.url && <audio controls src={midia.url} className="w-full" />}
            <p className="mt-1 text-sm italic">
              {mensagem.transcricao_status === "failed"
                ? "Não foi possível transcrever este áudio."
                : (mensagem.transcricao ?? "Transcrevendo…")}
            </p>
          </div>
        )}

        {mensagem.tipo === "documento" && midia?.url && (
          <a href={midia.url} target="_blank" rel="noreferrer" className="underline">
            Abrir documento
          </a>
        )}

        {mensagem.conteudo && <p className="whitespace-pre-wrap">{mensagem.conteudo}</p>}

        {mensagem.status === "falhou" && (
          <div
            className="mt-2 rounded px-2 py-1 text-xs"
            style={{ background: "var(--color-alerta)" }}
          >
            Não entregue.{" "}
            <button onClick={() => aoReenviar(mensagem.id)} className="underline">
              Tentar de novo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
