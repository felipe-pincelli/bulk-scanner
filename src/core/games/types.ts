/**
 * Contrato que cada jogo (TCG) precisa cumprir.
 * Hoje só existe Magic; no futuro: Pokémon (Pokémon TCG API), Yu-Gi-Oh! (YGOPRODeck).
 * Nas próximas etapas este contrato ganha a parte de preços.
 */

/** Retângulo em FRAÇÕES da carta (0 a 1), medido a partir do canto superior esquerdo. */
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
  /** Carrega a lista de nomes usada para corrigir erros do OCR. */
  loadNames(baseUrl: string): Promise<{ entries: NameEntry[]; updatedAt?: string }>;
}
