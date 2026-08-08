import { useQuery } from "@tanstack/react-query";
import { comSessao } from "@/lib/auth/sessao-expirada";
import { obterUrlDeMidia } from "@/lib/crm/crm.functions";
import { rotuloDeHorario } from "./rotulos";

/** Três aparências, não duas: confundir IA com humano faz o Pedro repetir ou
 *  contradizer o que a Mika já disse. */
const FUNDO: Record<string, string> = {
  lead: "var(--color-lead)",
  ia: "var(--color-ia)",
  humano: "var(--color-humano)",
};

/** Tipos com bolha própria abaixo. Qualquer outro tipo com mídia (o próximo
 *  que o provedor inventar) cai no fallback genérico, em vez de sumir. */
const TIPOS_COM_RENDER_ESPECIFICO = new Set(["imagem", "audio", "documento", "video", "sticker"]);

export function Bolha({ mensagem, aoReenviar }: { mensagem: any; aoReenviar: (id: string) => void }) {
  const daCasa = mensagem.remetente !== "lead";
  const temMidia = Boolean(mensagem.media_path);

  // timestamp_ms é bigint not null no banco, mas outros pontos do código
  // (leads.server.ts) tratam esse mesmo campo com Number(...) defensivamente
  // — mesmo padrão aqui: new Date(...).toISOString() lançaria RangeError
  // antes de rotuloDeHorario (que já trata nulidade/invalidade) ser chamado.
  const timestampMs = Number(mensagem.timestamp_ms);
  const timestampValido = Number.isFinite(timestampMs);
  const timestampIso = timestampValido ? new Date(timestampMs).toISOString() : null;

  const { data: midia } = useQuery({
    queryKey: ["midia", mensagem.id],
    queryFn: () => comSessao(obterUrlDeMidia({ data: { mensagemId: mensagem.id } })),
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
        <div className="mb-1 flex items-center gap-2 text-xs text-[var(--color-suave)]">
          <span>{mensagem.remetente === "lead" ? "Cliente" : mensagem.remetente === "ia" ? "Mika" : "Você"}</span>
          {timestampValido && (
            <time dateTime={timestampIso!}>
              {rotuloDeHorario(timestampIso)}
            </time>
          )}
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

        {mensagem.tipo === "video" && midia?.url && (
          <video controls src={midia.url} className="max-h-64 rounded" />
        )}

        {mensagem.tipo === "sticker" && midia?.url && (
          <img src={midia.url} alt="Figurinha" className="max-h-40 rounded" />
        )}

        {/* Defesa contra o próximo tipo de mídia que a UAZAPI mandar: sem
            isto, ele chegaria com URL assinada buscada e descartada, e a
            bolha renderizaria vazia — mensagem invisível pro operador. */}
        {temMidia && !TIPOS_COM_RENDER_ESPECIFICO.has(mensagem.tipo) && midia?.url && (
          <a href={midia.url} target="_blank" rel="noreferrer" className="underline">
            Abrir arquivo
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
