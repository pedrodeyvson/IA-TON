/**
 * Leads são inbound 1:1 — nunca grupo, status ou canal de newsletter. Módulo
 * puro (sem I/O) para poder testar a regra isoladamente do resto do ingest.
 */

const SUFIXOS_IGNORADOS = ["@g.us", "@broadcast", "@newsletter"];

export function deveIgnorarRemoteJid(remoteJid: string | null | undefined): boolean {
  if (!remoteJid) return false;
  if (remoteJid === "status@broadcast") return true;
  return SUFIXOS_IGNORADOS.some((sufixo) => remoteJid.endsWith(sufixo));
}
