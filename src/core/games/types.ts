/**
 * Contrato que cada jogo (TCG) precisa cumprir.
 * Hoje só existe Magic; no futuro: Pokémon (Pokémon TCG API), Yu-Gi-Oh! (YGOPRODeck).
 */

/** Retângulo em FRAÇÕES (0 a 1), medido a partir do canto superior esquerdo. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Um nome reconhecível. `matchText` é o que aparece impresso; `cardName` é o nome oficial. */
export interface NameEntry {
  matchText: string;
  cardName: string;
}

/** Uma impressão específica (edição + número de colecionador), com preços em dólar. */
export interface Printing {
  /** Código da edição, minúsculo (ex.: "2x2"). Na carta aparece em maiúsculas. */
  set: string;
  setName: string;
  /** Número de colecionador (ex.: "117", "117a", "★12"). */
  number: string;
  usd: number | null;
  usdFoil: number | null;
  usdEtched: number | null;
}

/** Faixa de preço de uma carta (todas as impressões), em dólares. */
export interface PriceInfo {
  /** Impressão mais barata (sem foil; se só existir foil, o foil mais barato). */
  minUsd: number | null;
  /** Impressão sem foil mais cara. */
  maxNonfoilUsd: number | null;
  /** Impressão mais cara, incluindo foil. */
  maxUsd: number | null;
  /** Edição da impressão mais cara. */
  maxSet: string;
  maxSetName: string;
  maxFinish: 'nonfoil' | 'foil' | 'etched' | '';
  /** Todas as impressões com preço (só quando há 2 ou mais). */
  printings?: Printing[];
}

/** Tudo o que o app precisa de um jogo: nomes (para o OCR) e preços. */
export interface CardIndex {
  entries: NameEntry[];
  prices: Map<string, PriceInfo>;
  source: string;
  pricesUpdatedAt: string;
  builtAt: string;
  /** Cotação USD→BRL do momento em que o índice foi gerado (reserva). */
  usdBrl: number | null;
}

/**
 * Proporções da carta usadas para achar o RODAPÉ (edição/número) a partir da
 * barra do nome. Tudo em frações da carta.
 */
export interface CardGeometry {
  /** Onde começa a faixa clara que contém o nome, e que largura ela tem. */
  barLeft: number;
  barWidth: number;
  /** Centro vertical do texto do nome. */
  nameCenterY: number;
  /** Região do rodapé com número/edição. */
  footer: Region;
  /** Altura das letras do rodapé. */
  footerTextH: number;
}

export interface GameProvider {
  id: string;
  displayName: string;
  /** Nome curto para botões/menus. */
  shortName: string;
  /** Largura ÷ altura da carta física (Magic: 63 mm ÷ 88 mm). */
  cardAspect: number;
  /** Onde fica o nome na carta (usado para calcular o tamanho das letras). */
  nameRegion: Region;
  /**
   * Faixa onde o app PROCURA o nome, em frações da área de detecção quadrada
   * (lado = altura da carta), com a carta em pé. É bem maior que o nome, para a
   * carta não precisar estar perfeitamente alinhada.
   */
  nameSearchBand: Region;
  /** Caracteres que podem aparecer num nome (ajuda o OCR a não "inventar" símbolos). */
  nameCharWhitelist: string;
  /** Arquivo do índice, relativo à pasta do site (gerado por scripts/build-data.ts). */
  indexFile: string;
  /** Converte o arquivo do índice no formato comum a todos os jogos. */
  parseIndex(json: unknown): CardIndex;
  geometry: CardGeometry;
  /** Como chamar as variantes de preço neste jogo (ex.: foil / reverse holo). */
  finishLabels: Record<PriceInfo['maxFinish'], string>;
  /** Exportação "com edição": formato de uma linha e nome do formato. */
  exportWithSet: {
    label: string;
    line: (count: number, name: string, set: string, number: string | null, finish?: 'nonfoil' | 'foil' | 'etched') => string;
  };
  /** Exportação simples (só nome): nome do formato. */
  exportPlainLabel: string;
  /** Dica de onde importar a lista. */
  importHint: string;
}
