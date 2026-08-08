// Captura respostas REAIS da OpenAI para virarem fixtures de teste.
// Rodar: bun --env-file=.env run scripts/capturar-openai.ts
import { mkdir, writeFile } from "node:fs/promises";

const MODELO = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const CHAVE = process.env.OPENAI_API_KEY;
if (!CHAVE) throw new Error("OPENAI_API_KEY não configurado");

const DESTINO = "src/lib/agente/fixtures";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "escalar_para_humano",
      description: "Escala a conversa para o consultor humano e para de responder.",
      parameters: {
        type: "object",
        properties: { motivo: { type: "string", description: "Por que está escalando" } },
        required: ["motivo"],
        additionalProperties: false,
      },
    },
  },
];

async function chamar(mensagens: unknown[], comTools: boolean) {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CHAVE}` },
    body: JSON.stringify({
      model: MODELO,
      messages: mensagens,
      ...(comTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
    }),
  });
  const texto = await resposta.text();
  console.log(`HTTP ${resposta.status}`);
  return { status: resposta.status, corpo: texto };
}

await mkdir(DESTINO, { recursive: true });

// 1) Turno que deve resultar em tool call.
const comTool = await chamar(
  [
    { role: "system", content: "Você é um consultor. Se o cliente pedir para falar com uma pessoa, chame a tool escalar_para_humano." },
    { role: "user", content: "quero falar com uma pessoa de verdade, não com robô" },
  ],
  true,
);
await writeFile(`${DESTINO}/openai-tool-call.json`, comTool.corpo);
console.log("gravado openai-tool-call.json");

// 2) Turno de texto puro.
const soTexto = await chamar(
  [
    { role: "system", content: "Você é um consultor de maquininhas. Responda em uma frase." },
    { role: "user", content: "oi, queria saber sobre maquininha" },
  ],
  false,
);
await writeFile(`${DESTINO}/openai-texto.json`, soTexto.corpo);
console.log("gravado openai-texto.json");
