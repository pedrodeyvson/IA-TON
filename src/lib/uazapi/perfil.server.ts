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
    return {
      bytes: new Uint8Array(await resposta.arrayBuffer()),
      mime: resposta.headers.get("content-type") ?? "image/jpeg",
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
 * Curto-circuita ANTES de qualquer chamada externa quando não há nada a
 * atualizar (nome já é de verdade e foto já existe): evita martelar a UAZAPI
 * a cada mensagem de um lead que simplesmente não tem foto no WhatsApp.
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
      if (nomeNovo) {
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
