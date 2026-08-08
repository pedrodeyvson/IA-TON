import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { listarMensagensDaConversa, reenviarMensagem } from "@/lib/crm/crm.functions";
import { Bolha } from "./Bolha";

const PAGINA = 50;

export function Historico({ conversaId }: { conversaId: string }) {
  const clienteQuery = useQueryClient();
  const fim = useRef<HTMLDivElement>(null);
  const [limite, setLimite] = useState(PAGINA);

  // Trocar de conversa reinicia a paginação — senão a próxima abre já expandida.
  useEffect(() => {
    setLimite(PAGINA);
  }, [conversaId]);

  const { data: mensagens = [] } = useQuery({
    queryKey: ["mensagens", conversaId, limite],
    queryFn: () => listarMensagensDaConversa({ data: { conversaId, limite } }),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const reenvio = useMutation({
    mutationFn: (mensagemId: string) => reenviarMensagem({ data: { mensagemId } }),
    onSuccess: () => clienteQuery.invalidateQueries({ queryKey: ["mensagens", conversaId] }),
  });

  // Rola quando chega mensagem NOVA — não quando o botão traz mensagens
  // antigas, que mudam o length do mesmo jeito e jogariam a tela de volta ao
  // fim, anulando o "carregar mais antigas".
  const ultimaId = mensagens[mensagens.length - 1]?.id;
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [ultimaId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-2">
      {/* Só oferece mais páginas enquanto a última veio cheia: se voltaram
          menos que o limite, o começo da conversa já está na tela. */}
      {mensagens.length >= limite && (
        <button
          onClick={() => setLimite((atual) => atual + PAGINA)}
          className="mx-auto mb-2 block text-sm text-[var(--color-suave)] underline"
        >
          Carregar mais antigas
        </button>
      )}
      {mensagens.map((mensagem: any) => (
        <Bolha key={mensagem.id} mensagem={mensagem} aoReenviar={(id) => reenvio.mutate(id)} />
      ))}
      <div ref={fim} />
    </div>
  );
}
