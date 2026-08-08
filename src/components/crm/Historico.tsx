import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comSessao } from "@/lib/auth/sessao-expirada";
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
    queryFn: () => comSessao(listarMensagensDaConversa({ data: { conversaId, limite } })),
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
  //
  // E SÓ rola se o operador já estava acompanhando o fim. Depender apenas de
  // `ultimaId` não bastava: com o poll de 5s, qualquer coisa que mude a última
  // mensagem (reordenação por empate de timestamp, mensagem nova, refetch que
  // devolve a lista vazia por um instante) arrancava a tela de volta para
  // baixo. Quem tinha subido para ler o começo da conversa era puxado a cada
  // 5 segundos e não conseguia ler nada.
  const caixa = useRef<HTMLDivElement>(null);
  const colado = useRef(true);

  function aoRolar() {
    const el = caixa.current;
    if (!el) return;
    // 80px de tolerância: "praticamente no fim" conta como acompanhar.
    colado.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const ultimaId = mensagens[mensagens.length - 1]?.id;
  const primeiraPintura = useRef(true);
  useEffect(() => {
    if (!ultimaId) return;
    if (primeiraPintura.current) {
      // Ao abrir a conversa vai direto para o fim, sem animação: a rolagem
      // suave de 4 mil pixels demora e parece travamento.
      primeiraPintura.current = false;
      fim.current?.scrollIntoView({ behavior: "auto" });
      return;
    }
    if (colado.current) fim.current?.scrollIntoView({ behavior: "smooth" });
  }, [ultimaId]);

  // Trocar de conversa volta a colar no fim.
  useEffect(() => {
    primeiraPintura.current = true;
    colado.current = true;
  }, [conversaId]);

  return (
    <div ref={caixa} onScroll={aoRolar} className="min-h-0 flex-1 overflow-y-auto py-2">
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
