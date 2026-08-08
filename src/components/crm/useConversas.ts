import { useQuery } from "@tanstack/react-query";
import { comSessao } from "@/lib/auth/sessao-expirada";
import { listarConversasDoInbox } from "@/lib/crm/crm.functions";

/** A listagem do inbox, compartilhada por toda tela que precisa dela.
 *  Um usuário só: 5s de polling custa nada e dispensa a infra do Realtime. */
export function useConversas() {
  return useQuery({
    queryKey: ["conversas"],
    queryFn: () => comSessao(listarConversasDoInbox()),
    refetchInterval: 5000,
    // Aba escondida não precisa acordar o banco a noite inteira; o
    // refetchOnWindowFocus do root traz tudo de volta ao voltar.
    refetchIntervalInBackground: false,
  });
}
