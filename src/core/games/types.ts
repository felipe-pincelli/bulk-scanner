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

export interface GameProvider {
  id: string;
  displayName: string;
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
}
