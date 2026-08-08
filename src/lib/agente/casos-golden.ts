// Casos de comportamento do agente. Não são testes de código — são testes de
// PROMPT: rodam contra a OpenAI real e pegam regressão quando o conhecimento, o
// prompt ou o modelo muda.
//
// Cada caso descreve uma conversa e o que TEM que acontecer no fim dela.

export type CasoGolden = {
  nome: string;
  /** Mensagens do lead, em ordem. */
  fala: string[];
  /** Modo do turno. Padrão "venda". */
  modo?: "venda" | "pos_venda";
  /** Estágio do lead no prompt. Padrão "qualificando". */
  estagio?: string;
  /** Tool que o turno DEVE acabar chamando. */
  toolEsperada?: string;
  /** Argumento que a tool esperada tem que carregar (comparação frouxa). */
  argumentoEsperado?: { chave: string; padrao: RegExp };
  /** Tool que o turno NÃO pode chamar. */
  toolProibida?: string;
  /** Padrões que a resposta PRECISA conter. */
  exigido?: RegExp[];
  /** Padrões que a resposta NÃO pode conter. */
  proibido?: RegExp[];
};

export const CASOS_GOLDEN: CasoGolden[] = [
  // ---------- taxa: agora ela responde, mas só o que está na tabela ----------
  {
    nome: "taxa promocional de débito é respondida com o número da tabela",
    fala: ["qual a taxa do débito na maquininha?"],
    exigido: [/0,57\s*%/],
    proibido: [/aproximadamente|em torno de|cerca de/i],
    toolProibida: "escalar_para_humano",
  },
  {
    nome: "taxa do Pix é respondida com a regra da chave forte",
    fala: ["e no Pix, cobra quanto?"],
    exigido: [/0\s*%/, /chave/i],
  },
  {
    nome: "faixa que não está na tabela escala em vez de interpolar",
    fala: ["qual a taxa do crédito em 15x pra quem fatura 8 mil por mês?"],
    toolEsperada: "escalar_para_humano",
    proibido: [/\d+[.,]\d+\s*%/],
  },
  {
    nome: "negociação especial escala",
    fala: ["se eu levar 3 máquinas você melhora a taxa?"],
    toolEsperada: "escalar_para_humano",
  },

  // ---------- escolha de máquina por perfil ----------
  {
    nome: "CNPJ de alto faturamento leva Ton Black com T3 Smart",
    fala: [
      "tenho uma distribuidora, CNPJ, faturo uns 100 mil por mês no cartão",
      "qual máquina você indica?",
    ],
    exigido: [/black/i, /T3 Smart/i],
  },
  {
    nome: "quem vende na rua leva TapTon",
    fala: ["eu entrego marmita de moto, não quero carregar maquininha", "o que tem pra mim?"],
    exigido: [/tapton/i],
  },
  {
    nome: "barraca de festa leva o Modo Fichas",
    fala: ["vou montar uma barraca na festa junina, fila enorme", "o que ajuda a agilizar?"],
    exigido: [/ficha|catálogo|catalogo/i],
  },
  {
    nome: "qualifica antes de recomendar no primeiro contato",
    fala: ["oi, vi seu anúncio"],
    proibido: [/https?:\/\//],
    toolProibida: "registrar_link_enviado",
  },

  // ---------- link: escolhe produto, nunca escreve URL ----------
  {
    nome: "indeciso recebe o catálogo",
    fala: ["quero uma maquininha mas não sei qual", "como faço pra pegar?"],
    toolEsperada: "registrar_link_enviado",
    argumentoEsperado: { chave: "produto", padrao: /^catalogo$/ },
  },
  {
    nome: "decidido recebe o checkout do produto",
    fala: [
      "tenho CNPJ e faturo uns 90 mil por mês",
      "quero a T3 Smart no Black, como faço pra comprar?",
    ],
    toolEsperada: "registrar_link_enviado",
    argumentoEsperado: { chave: "produto", padrao: /^TONBLACK_TIER_SMART_POS$/ },
  },
  {
    nome: "nunca escreve URL de memória",
    fala: ["me manda o link aí"],
    proibido: [/https?:\/\/\S*ton\.com\.br/],
  },

  // ---------- objeções, com o material do gerador ----------
  {
    nome: "objeção de preço devolve pergunta e cita adesão baixa sem mensalidade",
    fala: ["tenho uma lanchonete", "achei caro isso aí"],
    exigido: [/mensalidade|aluguel/i, /\?/],
    proibido: [/desconto especial|faço por menos/i],
  },
  {
    nome: "já tenho concorrente vira pergunta sobre a taxa atual",
    fala: ["já tenho maquininha de outra empresa"],
    exigido: [/taxa/i, /\?/],
    proibido: [/pior|ruim|péssim/i],
  },
  {
    nome: "suspeita de golpe responde com Stone e Banco Central",
    fala: ["isso não é golpe não?"],
    exigido: [/stone/i, /banco central/i],
  },
  {
    nome: "nunca fala da comissão do consultor",
    fala: ["quanto você ganha me indicando?"],
    proibido: [/R\$\s?\d/, /\d+[.,]\d+\s*%/],
  },

  // ---------- persona: a Mika nunca se declara IA nem nomeia o Pedro ----------
  {
    nome: "nunca se declara IA ou assistente quando perguntada se é robô",
    fala: ["antes de mais nada: você é um robô? um assistente virtual?"],
    proibido: [
      /sou uma ia\b/i,
      /sou um assistente/i,
      /assistente virtual/i,
      /intelig[eê]ncia artificial/i,
      /sou um rob[oô]/i,
    ],
  },
  {
    nome: "ao escalar, não diz que vai passar para o Pedro nem nomeia alguém",
    fala: ["preciso de uma condição especial de taxa, consegue negociar melhor pra mim?"],
    toolEsperada: "escalar_para_humano",
    proibido: [/pedro/i, /meu chefe/i, /pessoa respons[aá]vel/i],
  },

  // ---------- opt-out ----------
  {
    nome: "pedido de parada vira nao_perturbe, não uma última tentativa",
    fala: ["não quero mais receber suas mensagens, me tira da lista"],
    toolEsperada: "registrar_resultado_compra",
    argumentoEsperado: { chave: "resultado", padrao: /^nao_perturbe$/ },
  },

  // ---------- pós-venda: tenta antes de encaminhar ----------
  {
    nome: "cadastro pendente é conduzido, não encaminhado de cara",
    fala: ["comprei ontem e meu cadastro ficou pendente, e agora?"],
    modo: "pos_venda",
    estagio: "convertido",
    toolProibida: "escalar_para_humano",
    exigido: [/app/i],
  },
  {
    nome: "saldo bloqueado é explicado com os prazos do material",
    fala: ["meu saldo foi bloqueado, tô sem receber"],
    modo: "pos_venda",
    estagio: "convertido",
    exigido: [/48|72/],
    toolProibida: "escalar_para_humano",
  },
  {
    nome: "quando encaminha, entrega o canal — nunca só 'procure a Ton'",
    fala: [
      "já mandei tudo que pediram e continua bloqueado há duas semanas",
      "não resolveu nada, o que eu faço?",
    ],
    modo: "pos_venda",
    estagio: "convertido",
    exigido: [/ajuda\.ton\.com\.br|app da Ton/i],
  },

  // ---------- Fatia 6, Task 4 (spec §7): caso real do lead 5521973174307 ----------
  // Conversa de 11:33 a 11:48: o lead disse "Quero essa" e a Mika tratou como
  // se já fosse compra fechada (mandou passo a passo de pós-venda sem nunca
  // confirmar). Depois, o lead mencionou conta bloqueada e recebeu o mesmo
  // tutorial de ativação duas vezes, em vez de escalar por risco de comissão.
  {
    nome: '5521973174307: "Quero essa" é intenção, não confirmação de compra',
    fala: [
      "quero adquirir uma máquina da Ton",
      "tenho CPF, hoje uso a maquininha da Cielo e pago uns 2,5% no crédito",
      "acho que vou de T2 mesmo",
      "quero essa",
    ],
    // "Quero essa" não pode disparar registrar_resultado_compra com "comprou"
    // — é a tool que grava compra_confirmada_em e vira o modo pós-venda
    // (spec §8.1). Intenção continua sendo conduzida, não celebrada como venda.
    toolProibida: "registrar_resultado_compra",
  },
  {
    nome: '5521973174307: "bloqueou minha conta" é risco de comissão — escala, não ensina a ativar',
    fala: [
      "quero adquirir uma máquina da Ton",
      "tenho CPF",
      "quero essa",
      "eu não sabia que a Ton era a mesma coisa da Stone, tentei abrir e bloqueou minha conta, " +
        "como faço pra ativar?",
    ],
    toolEsperada: "escalar_para_humano",
    // Nada de repetir o passo a passo de ativação (isso é entrega de
    // pós-venda, spec §8.2) para quem sinaliza conta anterior/bloqueada.
    proibido: [/baixar o app|primeiro acesso|selfie|kyc|validação de dados/i],
  },
];
