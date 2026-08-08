import { test } from "node:test";
import assert from "node:assert/strict";
import { responderComoHumano, reenviarFalhada } from "./inbox.server.ts";

/**
 * Dublê mínimo do client do Supabase, registrando a ordem das operações.
 * `leads` e `conversas` respondem a update; `mensagens` responde a insert e
 * update, como enviarTextoDoCrm espera. `mensagem`/`erroNaMensagem` alimentam
 * a leitura que `reenviarFalhada` faz da própria linha antes de reenviar.
 */
function adminFalso(
  opcoes: {
    telefone?: string | null;
    leadExiste?: boolean;
    erroNoLead?: string;
    mensagem?: { status?: string; conteudo?: string | null; conversaId?: string; leadId?: string };
    erroNaMensagem?: string;
    /**
     * Simula concorrência no CAS de `reenviarFalhada`: a partir da tentativa
     * seguinte à N-ésima, o UPDATE filtrado por `status = "falhou"` devolve
     * lista vazia, como se outra chamada já tivesse levado a linha.
     */
    casFalhaApos?: number;
  } = {},
) {
  const ordem: string[] = [];
  const telefone = opcoes.telefone === undefined ? "5511999999999" : opcoes.telefone;
  const leadExiste = opcoes.leadExiste !== false;
  let tentativasCas = 0;

  const admin: any = {
    ordem,
    from(tabela: string) {
      // Escopo por chamada a `.from(...)`: cada statement do código real
      // cria a sua própria consulta, então os filtros de uma não vazam para
      // a próxima.
      let filtroStatus: string | undefined;
      let camposUpdate: Record<string, unknown> | null = null;

      const consulta: any = {
        select() {
          return consulta;
        },
        eq(coluna: string, valor: unknown) {
          if (coluna === "status") filtroStatus = valor as string;
          return consulta;
        },
        maybeSingle: async () => {
          ordem.push(`select:${tabela}`);
          if (tabela === "mensagens") {
            if (opcoes.erroNaMensagem) return { data: null, error: { message: opcoes.erroNaMensagem } };
            if (!opcoes.mensagem) return { data: null, error: null };
            return {
              data: {
                id: "msg-1",
                conversa_id: opcoes.mensagem.conversaId ?? "conv-1",
                lead_id: opcoes.mensagem.leadId ?? "lead-1",
                conteudo: opcoes.mensagem.conteudo ?? "oi",
                status: opcoes.mensagem.status ?? "falhou",
              },
              error: null,
            };
          }
          if (tabela !== "leads") return { data: {}, error: null };
          // O dublê precisa saber devolver lead ausente e erro de banco: são
          // dois caminhos distintos do código, e sem isso ficariam sem teste.
          if (opcoes.erroNoLead) return { data: null, error: { message: opcoes.erroNoLead } };
          return { data: leadExiste ? { id: "lead-1", telefone } : null, error: null };
        },
        single: async () => {
          ordem.push(`insert:${tabela}`);
          return { data: { id: "msg-1" }, error: null };
        },
        insert() {
          return consulta;
        },
        update(campos: Record<string, unknown>) {
          camposUpdate = campos;
          // Mensagens registram o status entre parênteses — e o
          // provider_message_id junto dele, quando houver — para a ordem
          // pendente -> envio -> enviada/falhou e o carimbo do provedor
          // ficarem verificáveis nos testes de reenviarFalhada.
          if (tabela === "mensagens" && typeof campos.status === "string") {
            const carimbo =
              typeof campos.provider_message_id === "string"
                ? ` provider_message_id=${campos.provider_message_id}`
                : "";
            ordem.push(`update:mensagens:status(${campos.status})${carimbo}`);
          } else {
            ordem.push(`update:${tabela}:${Object.keys(campos).join(",")}`);
          }
          return consulta;
        },
        // Torna a consulta "awaitable" diretamente — com ou sem `.select("id")`
        // no fim. reenviarFalhada faz `await admin.from(...).update(...).eq(...)`
        // e também, no CAS, `...eq(...).select("id")`; as duas formas precisam
        // resolver para `{ data, error }`.
        then(resolver: (valor: { data: unknown; error: unknown }) => void, rejeitar: (erro: unknown) => void) {
          Promise.resolve()
            .then(() => {
              if (!camposUpdate) {
                resolver({ data: null, error: null });
                return;
              }
              // O CAS é a única escrita que sai de "falhou" filtrando por ele:
              // `.update({ status: "pendente" }).eq("id", ...).eq("status", "falhou")`.
              if (tabela === "mensagens" && camposUpdate.status === "pendente" && filtroStatus === "falhou") {
                tentativasCas += 1;
                const perdeuACorrida =
                  opcoes.casFalhaApos !== undefined && tentativasCas > opcoes.casFalhaApos;
                resolver({ data: perdeuACorrida ? [] : [{ id: "msg-1" }], error: null });
                return;
              }
              resolver({ data: null, error: null });
            })
            .catch(rejeitar);
        },
      };
      return consulta;
    },
  };
  return admin;
}

test("pausa a IA antes de enviar", async () => {
  const admin = adminFalso();
  const enviados: string[] = [];

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi, aqui é o Pedro" },
    {
      enviar: async (_numero, texto) => {
        admin.ordem.push("envio");
        enviados.push(texto);
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(resultado.ok, true);
  const posPausa = admin.ordem.findIndex((p: string) => p.startsWith("update:conversas:pausada_pela_ia"));
  const posEnvio = admin.ordem.indexOf("envio");
  assert.ok(posPausa !== -1, "não pausou a IA");
  // Na ordem inversa, um worker acordando no meio entregaria a resposta da IA
  // logo depois da humana, possivelmente se contradizendo.
  assert.ok(posPausa < posEnvio, "pausou depois de enviar");
});

test("usa o telefone do banco, ignorando o que vier de fora", async () => {
  const admin = adminFalso({ telefone: "5511888888888" });
  let numeroUsado = "";

  await responderComoHumano(
    admin,
    // O tipo não aceita telefone; este teste garante que, mesmo que alguém
    // acrescente o campo depois, o valor do banco continua ganhando.
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi", telefone: "5511000000000" } as any,
    {
      enviar: async (numero) => {
        numeroUsado = numero;
        return { messageid: "prov-1" };
      },
    },
  );

  assert.equal(numeroUsado, "5511888888888");
});

test("lead sem telefone não envia e explica o motivo", async () => {
  const admin = adminFalso({ telefone: null });
  let chamou = false;

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        chamou = true;
        return {};
      },
    },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /telefone/i);
  assert.equal(chamou, false);
});

test("texto em branco é recusado antes de qualquer escrita", async () => {
  const admin = adminFalso();
  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "   " },
    { enviar: async () => ({}) },
  );
  assert.equal(resultado.ok, false);
  assert.deepEqual(admin.ordem, []);
});

test("falha no envio devolve erro sem lançar", async () => {
  const admin = adminFalso();
  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        throw new Error("uazapi fora do ar");
      },
    },
  );
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /uazapi/i);
});

test("lead inexistente não envia e não lança", async () => {
  // Sem este teste, apagar a guarda de lead ausente passaria despercebido — e
  // o efeito seria um TypeError em lead.telefone, quebrando o contrato de
  // "nunca lança" de que o worker e a server function dependem.
  const admin = adminFalso({ leadExiste: false });
  let chamou = false;

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "sumido", texto: "oi" },
    {
      enviar: async () => {
        chamou = true;
        return {};
      },
    },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /lead/i);
  assert.equal(chamou, false);
});

test("erro de banco no lookup não vira 'lead não encontrado'", async () => {
  // Falha de conexão e lead inexistente são causas diferentes; confundi-las
  // esconde uma queda de banco atrás de uma mensagem tranquilizadora.
  const admin = adminFalso({ erroNoLead: "connection reset" });

  const resultado = await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    { enviar: async () => ({}) },
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /connection reset/i);
});

test("marca como lida tanto no sucesso quanto na falha de envio", async () => {
  // Abrir a conversa e responder é a definição de "li". Se marcarLida sumisse,
  // nenhum dos outros testes notaria.
  const comSucesso = adminFalso();
  await responderComoHumano(
    comSucesso,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    { enviar: async () => ({ messageid: "prov-1" }) },
  );
  assert.ok(
    comSucesso.ordem.some((p: string) => p.startsWith("update:leads:nao_lidas")),
    "não marcou como lida depois de enviar",
  );

  const comFalha = adminFalso();
  await responderComoHumano(
    comFalha,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    {
      enviar: async () => {
        throw new Error("uazapi fora do ar");
      },
    },
  );
  assert.ok(
    comFalha.ordem.some((p: string) => p.startsWith("update:leads:nao_lidas")),
    "não marcou como lida quando o envio falhou",
  );
});

test("lead sem telefone nem chega a pausar a IA", async () => {
  // Não há o que assumir numa conversa para a qual não dá para responder.
  const admin = adminFalso({ telefone: null });
  await responderComoHumano(
    admin,
    { conversaId: "conv-1", leadId: "lead-1", texto: "oi" },
    { enviar: async () => ({}) },
  );
  assert.equal(
    admin.ordem.some((p: string) => p.startsWith("update:conversas:pausada_pela_ia")),
    false,
  );
});

test("reenvio marca pendente antes de enviar e enviada depois", async () => {
  // Passar por "pendente" é o que impede o duplo clique: a guarda de status
  // recusa qualquer segunda tentativa enquanto a primeira está em curso.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  const resultado = await reenviarFalhada(admin, "msg-1", {
    enviar: async () => {
      admin.ordem.push("envio");
      return { messageid: "prov-9" };
    },
  });

  assert.equal(resultado.ok, true);
  const pendente = admin.ordem.findIndex((p: string) => p === "update:mensagens:status(pendente)");
  const envio = admin.ordem.indexOf("envio");
  const enviada = admin.ordem.findIndex((p: string) => p.startsWith("update:mensagens:status(enviada)"));
  assert.ok(pendente !== -1 && pendente < envio, "não marcou pendente antes de enviar");
  assert.ok(enviada > envio, "não marcou enviada depois do envio");
});

test("reenvio não insere mensagem nova", async () => {
  // O bug que motivou esta função: inserir outra linha deixava a original em
  // falhou, o botão de reenviar nunca sumia e cada clique era um WhatsApp.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "prov-9" }) });
  assert.equal(
    admin.ordem.some((p: string) => p.startsWith("insert:mensagens")),
    false,
  );
});

test("mensagem que não está falhada é recusada", async () => {
  const admin = adminFalso({ mensagem: { status: "enviada", conteudo: "oi" } });
  let chamou = false;
  const resultado = await reenviarFalhada(admin, "msg-1", {
    enviar: async () => {
      chamou = true;
      return {};
    },
  });
  assert.equal(resultado.ok, false);
  assert.equal(chamou, false);
});

test("erro de banco ao ler a mensagem não vira 'não encontrada'", async () => {
  const admin = adminFalso({ erroNaMensagem: "connection reset" });
  const resultado = await reenviarFalhada(admin, "msg-1", { enviar: async () => ({}) });
  assert.equal(resultado.ok, false);
  assert.match(resultado.erro ?? "", /connection reset/i);
});

test("falha no reenvio devolve a mensagem para falhou", async () => {
  // Senão a linha fica presa em "pendente" e o operador perde o botão.
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  const resultado = await reenviarFalhada(admin, "msg-1", {
    enviar: async () => {
      throw new Error("uazapi fora do ar");
    },
  });
  assert.equal(resultado.ok, false);
  assert.ok(
    admin.ordem.some((p: string) => p.startsWith("update:mensagens:status(falhou)")),
    "não devolveu para falhou",
  );
});

test("segunda chamada concorrente não reenvia — o CAS recusa", async () => {
  // O update é que barra, não a leitura: as duas chamadas leem "falhou".
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" }, casFalhaApos: 1 });
  const primeira = await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "p1" }) });
  const segunda = await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "p2" }) });

  assert.equal(primeira.ok, true);
  assert.equal(segunda.ok, false);
  assert.match(segunda.erro ?? "", /andamento/i);
});

test("falha ao preparar o envio não deixa a linha em pendente", async () => {
  // Sem `deps.enviar`, reenviarFalhada cai no resolverEnvioUazapi() de
  // verdade, que lança quando UAZAPI_TOKEN não está configurado — é
  // exatamente o caminho que o try/catch ANTES do CAS protege. Um
  // `deps.enviar` que só lança quando CHAMADO não serve para este teste: a
  // resolução do remetente apenas referencia `deps.enviar`, nunca o invoca,
  // então esse throw só apareceria depois do CAS já ter marcado `pendente` —
  // e o teste estaria provando a coisa errada.
  const tokenOriginal = process.env.UAZAPI_TOKEN;
  delete process.env.UAZAPI_TOKEN;
  try {
    const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
    const resultado = await reenviarFalhada(admin, "msg-1", {});
    assert.equal(resultado.ok, false);
    assert.equal(
      admin.ordem.some((p: string) => p.includes("status(pendente)")),
      false,
      "mexeu no status antes de saber que conseguiria enviar",
    );
  } finally {
    if (tokenOriginal === undefined) delete process.env.UAZAPI_TOKEN;
    else process.env.UAZAPI_TOKEN = tokenOriginal;
  }
});

test("carimba o provider_message_id do reenvio", async () => {
  const admin = adminFalso({ mensagem: { status: "falhou", conteudo: "oi" } });
  await reenviarFalhada(admin, "msg-1", { enviar: async () => ({ messageid: "prov-9" }) });
  assert.ok(
    admin.ordem.some((p: string) => p.includes("provider_message_id=prov-9")),
    "não gravou o id do provedor",
  );
});
