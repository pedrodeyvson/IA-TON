// src/lib/uazapi/perfil.server.ts
// I/O: UAZAPI (perfil + imagem) e Storage (bucket crm-avatars). Nunca lança —
// best-effort, mesmo princípio de baixarMidia em ingest.server.ts: uma falha
// aqui não pode custar o processamento da mensagem que disparou a sincronização.
import { nomeEhPlaceholder, escolherNomeDoPerfil, type PerfilUazapi } from "./perfil.ts";

const BUCKET_AVATARS = "crm-avatars";

export type DepsPerfil = {
  /** Injetáveis só para teste. Em produção resolvem para UAZAPI/fetch/Storage reais. */
  buscarPerfil?: (numero: string) => Promise<PerfilUazapi | null>;
  baixarImagem?: (url: string) => Promise<{ bytes: Uint8Array; mime: string } | null>;
  enviarImagem?: (
    admin: any,
    path: string,
    bytes: Uint8Array,
    mime: string,
  ) => Promise<{ ok: boolean }>;
};

async function buscarPerfilReal(numero: string): Promise<PerfilUazapi | null> {
  const token = process.env.UAZAPI_TOKEN;
  if (!token) return null;
  const { obterDetalhesDoChat } = await import("./client.server.ts");
  return obterDetalhesDoChat(token, numero);
}

async function baixarImagemReal(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resposta.ok) return null;
    // Uma resposta 200 com corpo que não é imagem (ex.: página HTML de erro
    // de CDN quando o link já expirou) nunca deve virar a "foto" do lead —
    // isso setaria foto_path e o curto-circuito pararia de tentar de novo.
    const mime = resposta.headers.get("content-type") ?? "image/jpeg";
    if (!mime.startsWith("image/")) return null;
    return {
      bytes: new Uint8Array(await resposta.arrayBuffer()),
      mime,
    };
  } catch {
    return null;
  }
}

async function enviarImagemReal(
  admin: any,
  path: string,
  bytes: Uint8Array,
  mime: string,
): Promise<{ ok: boolean }> {
  const { error } = await admin.storage
    .from(BUCKET_AVATARS)
    .upload(path, bytes, { contentType: mime, upsert: true });
  return { ok: !error };
}

/**
 * Busca nome/foto reais do WhatsApp e atualiza o lead — só o que falta.
 * Curto-circuita ANTES de qualquer chamada externa apenas quando NÃO há nada
 * a atualizar (nome já é de verdade E foto já está gravada): evita repetir a
 * chamada a `/chat/details` quando os dois já foram resolvidos. Isso NÃO
 * cobre o lead que simplesmente não tem foto no WhatsApp — `foto_path` nunca
 * é setado nesse caso, então `precisaFoto` continua `true` para sempre e
 * `/chat/details` volta a ser chamado a cada mensagem de entrada desse lead
 * (achado da revisão final da Fatia 5; corrigir isso — ex.: cooldown ou
 * marcador de "já tentamos e não tinha foto" — está fora do escopo aqui).
 */
export async function sincronizarPerfil(
  admin: any,
  leadId: string,
  telefone: string | null,
  deps: DepsPerfil = {},
): Promise<{ atualizouNome: boolean; atualizouFoto: boolean }> {
  const NADA = { atualizouNome: false, atualizouFoto: false };
  if (!telefone) return NADA;

  try {
    const { data: lead } = await admin
      .from("leads")
      .select("nome, foto_path")
      .eq("id", leadId)
      .maybeSingle();

    const precisaNome = nomeEhPlaceholder(lead?.nome, telefone);
    const precisaFoto = !lead?.foto_path;
    if (!precisaNome && !precisaFoto) return NADA;

    const buscar = deps.buscarPerfil ?? buscarPerfilReal;
    const perfil = await buscar(telefone);
    if (!perfil) return NADA;

    let atualizouNome = false;
    if (precisaNome) {
      const nomeNovo = escolherNomeDoPerfil(perfil);
      // O WhatsApp costuma devolver o telefone como wa_name pra contatos que
      // não estão salvos na agenda — escolherNomeDoPerfil pode devolver esse
      // outro placeholder. Não grava sem checar de novo, senão precisaNome
      // fica true pra sempre (nunca resolve de verdade).
      if (nomeNovo && !nomeEhPlaceholder(nomeNovo, telefone)) {
        await admin.from("leads").update({ nome: nomeNovo }).eq("id", leadId);
        atualizouNome = true;
      }
    }

    let atualizouFoto = false;
    if (precisaFoto && perfil.image) {
      const baixar = deps.baixarImagem ?? baixarImagemReal;
      const imagem = await baixar(perfil.image);
      if (imagem) {
        const subtipo = (imagem.mime.split("/")[1] ?? "jpg").split(";")[0];
        const extensao = subtipo === "jpeg" ? "jpg" : subtipo;
        const path = `${leadId}.${extensao}`;
        const enviar = deps.enviarImagem ?? enviarImagemReal;
        const resultado = await enviar(admin, path, imagem.bytes, imagem.mime);
        if (resultado.ok) {
          await admin.from("leads").update({ foto_path: path }).eq("id", leadId);
          atualizouFoto = true;
        }
      }
    }

    return { atualizouNome, atualizouFoto };
  } catch (err: any) {
    console.warn(`[perfil] falha ao sincronizar perfil do lead ${leadId}:`, err?.message ?? err);
    return NADA;
  }
}
