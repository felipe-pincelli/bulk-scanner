import { parseIndex } from '../indexFormat';
import type { GameProvider } from '../types';

/**
 * Yu-Gi-Oh! TCG. Dados: TCGCSV (TCGplayer) + nomes em português do YGOPRODeck —
 * scripts/yugioh.ts.
 *
 * Na carta (59 × 86 mm, mais estreita que Magic/Pokémon):
 * - NOME no topo, na caixa do nome (texto escuro em monstros normais/efeito,
 *   claro em Magias/Armadilhas/XYZ/Link); o círculo do ATRIBUTO fica à direita;
 * - CÓDIGO ("LOB-EN001", ou "LOB-PT001" em português) logo abaixo da arte, à
 *   direita (~73% da altura); "1st Edition" fica do lado esquerdo, na mesma altura.
 * Variantes de preço: unlimited · 1ª edição · raridade especial (Starlight, Ghost…).
 */
export const yugiohProvider: GameProvider = {
  id: 'yugioh',
  displayName: 'Yu-Gi-Oh! TCG',
  shortName: 'Yu-Gi-Oh!',
  cardAspect: 59 / 86,
  nameRegion: { x: 0.07, y: 0.035, w: 0.72, h: 0.065 },
  nameSearchBand: { x: 0, y: 0, w: 1, h: 0.25 },
  // Caixa do nome escura (Magias/Armadilhas): o leitor de linha olha da esquerda
  // até antes do círculo do atributo.
  nameHintSpan: [0.12, 0.72],
  // "Ash Blossom & Joyous Spring", "Number 39: Utopia", "D/D/D Doom King".
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',-.&!?:/\"",
  indexFile: 'data/yugioh-index.json',
  parseIndex: (json) => parseIndex(json),
  geometry: {
    barLeft: 0.06,
    barWidth: 0.78,
    nameCenterY: 0.07,
    // Abaixo da arte, à direita: "LOB-EN001".
    footer: { x: 0.5, y: 0.71, w: 0.47, h: 0.055 },
    footerTextH: 0.014,
    footerSlack: 0, // a arte fica logo acima do código
  },
  finishLabels: { nonfoil: 'unlimited', foil: '1ª edição', etched: 'rara especial', '': '' },
  exportWithSet: {
    label: 'Lista com código — "1 Blue-Eyes White Dragon (LOB-EN001)"',
    line: (count, name, _set, number) => `${count} ${name}${number ? ` (${number})` : ''}`,
  },
  exportPlainLabel: 'Lista simples (só nome) — YGOPRODeck, Dueling Book…',
  importHint: 'Cole a lista no importador do site (ex.: YGOPRODeck → Collection/Deck → Import). Se o site não aceitar o código, use a lista simples.',
};
