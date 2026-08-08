// Fake mínimo do query builder do supabase-js, só com o encadeamento que os
// módulos deste projeto usam. NÃO tem sufixo .test.ts de propósito: o runner
// coleta "src/**/*.test.ts" e este arquivo é helper, não suíte.
//
// Uso:
//   const admin = criarAdminFake({ "leads.select": { data: { id: "L1" }, error: null } });
//   await obterLead(admin, "L1");
//   assert.equal(admin.chamadas[0].tabela, "leads");

export type ChamadaFake = {
  tabela: string;
  operacao: "select" | "insert" | "update" | "delete";
  payload?: any;
  filtros: Array<[string, any]>;
};

type Resposta = { data?: any; error?: any };
type Respostas = Record<string, Resposta | ((chamada: ChamadaFake) => Resposta)>;

export function criarAdminFake(respostas: Respostas = {}) {
  const chamadas: ChamadaFake[] = [];

  function construir(tabela: string) {
    const chamada: ChamadaFake = { tabela, operacao: "select", filtros: [] };
    let registrada = false;

    // Só resolve no fim do encadeamento (await, .maybeSingle(), .single()),
    // quando a operação e os filtros já estão todos definidos.
    function finalizar(): Resposta {
      if (!registrada) {
        chamadas.push(chamada);
        registrada = true;
      }
      const bruto = respostas[`${chamada.tabela}.${chamada.operacao}`];
      const resposta = typeof bruto === "function" ? bruto(chamada) : bruto;
      return resposta ?? { data: null, error: null };
    }

    const api: any = {
      select: () => api,
      insert: (payload: any) => { chamada.operacao = "insert"; chamada.payload = payload; return api; },
      update: (payload: any) => { chamada.operacao = "update"; chamada.payload = payload; return api; },
      delete: () => { chamada.operacao = "delete"; return api; },
      eq: (coluna: string, valor: any) => { chamada.filtros.push([coluna, valor]); return api; },
      is: (coluna: string, valor: any) => { chamada.filtros.push([coluna, valor]); return api; },
      lte: (coluna: string, valor: any) => { chamada.filtros.push([coluna, valor]); return api; },
      order: () => api,
      limit: () => api,
      maybeSingle: () => Promise.resolve(finalizar()),
      single: () => Promise.resolve(finalizar()),
      // Torna o builder "thenable": `await admin.from(x).update(y).eq(...)`
      // resolve aqui, igual ao supabase-js.
      then: (aoResolver: any, aoRejeitar: any) =>
        Promise.resolve(finalizar()).then(aoResolver, aoRejeitar),
    };

    return api;
  }

  return { from: construir, chamadas };
}
