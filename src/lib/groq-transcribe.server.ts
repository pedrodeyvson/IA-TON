// Server-only. Transcrição via Groq (Whisper). Docs: https://console.groq.com/docs/speech-to-text
const URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODELO = "whisper-large-v3-turbo";
const TIMEOUT_MS = 60_000;

const EXTENSAO_POR_MIME: Record<string, string> = {
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/wav": "wav", "audio/webm": "webm",
};

function extensaoDe(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXTENSAO_POR_MIME[base] ?? "ogg";
}

export type ResultadoTranscricao =
  | { ok: true; texto: string }
  | { ok: false; erro: string };

/** Nunca lança: falha de transcrição não pode derrubar o fluxo da mensagem. */
export async function transcreverAudio(
  bytes: Uint8Array,
  mime: string,
  opts: { idioma?: string } = {},
): Promise<ResultadoTranscricao> {
  const chave = process.env.GROQ_API_KEY;
  if (!chave) return { ok: false, erro: "GROQ_API_KEY não configurado" };

  try {
    const extensao = extensaoDe(mime);
    // Cópia para ArrayBuffer "puro" — Blob rejeita Uint8Array<SharedArrayBuffer>.
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mime || `audio/${extensao}` }), `audio.${extensao}`);
    form.append("model", MODELO);
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (opts.idioma) form.append("language", opts.idioma);

    const resposta = await fetch(URL_GROQ, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const texto = await resposta.text();
    if (!resposta.ok) return { ok: false, erro: `Groq ${resposta.status}: ${texto.slice(0, 200)}` };

    let corpo: any = null;
    try { corpo = JSON.parse(texto); } catch { /* ignore */ }
    const transcrito = (corpo?.text ?? "").toString().trim();
    if (!transcrito) return { ok: false, erro: "Groq não devolveu texto" };
    return { ok: true, texto: transcrito };
  } catch (err: any) {
    return { ok: false, erro: err?.message ?? "erro desconhecido" };
  }
}

/** Nunca lança: mesmo padrão de transcreverAudio — falha de download ou de
 * leitura do Blob (ex.: storage-js relançando algo fora de StorageError, ou
 * `.arrayBuffer()` sobre um Blob corrompido) vira resultado, não exceção. */
export async function transcreverDoStorage(
  admin: any, bucket: string, path: string, mime: string | null, idioma = "pt",
): Promise<ResultadoTranscricao> {
  try {
    const { data, error } = await admin.storage.from(bucket).download(path);
    if (error || !data) return { ok: false, erro: error?.message ?? "download falhou" };
    const buffer = await (data as Blob).arrayBuffer();
    return transcreverAudio(new Uint8Array(buffer), mime ?? "audio/ogg", { idioma });
  } catch (err: any) {
    return { ok: false, erro: err?.message ?? "erro desconhecido" };
  }
}
