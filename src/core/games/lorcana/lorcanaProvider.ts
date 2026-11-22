import { parseIndex } from '../indexFormat';
import type { GameProvider } from '../types';

/**
 * Disney Lorcana. Dados: TCGCSV (TCGplayer) — scripts/lorcana.ts. Só inglês
 * (não há edição oficial em português).
 *
 * Na carta:
 * - NOME no meio, logo abaixo da arte, em DUAS linhas: personagem em letras
 *   grandes ("MICKEY MOUSE") e a versão embaixo ("Brave Little Tailor"). O nome
 *   completo é "Mickey Mouse - Brave Little Tailor" — por isso o app junta as
 *   duas linhas lidas (`nameJoinsLines`). Ações/itens/canções têm uma linha só.
 * - força/vontade ficam à direita do nome (fora da dica de linha);
 * - NÚMERO no canto inferior esquerdo: "12/204 • EN • 1" (número/total identifica
 *   a coleção, como no Pokémon).
 */
export const lorcanaProvider: GameProvider = {
  id: 'lorcana',
  displayName: 'Disney Lorcana',
  shortName: 'Lorcana',
  cardAspect: 63 / 88,
  nameRegion: { x: 0.1, y: 0.56, w: 0.7, h: 0.065 },
  // Faixa no meio da carta (de 47% a 67% da altura): nome, versão e
  // classificação, parando antes do texto de regras.
  nameSearchBand: { x: 0, y: 0.47, w: 1, h: 0.2 },
  nameHintSpan: [0.06, 0.78],
  nameIsTallestText: true,
  nameJoinsLines: true,
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',-.&!?",
  indexFile: 'data/lorcana-index.json',
  parseIndex: (json) => parseIndex(json),
  geometry: {
    barLeft: 0.05,
    barWidth: 0.9,
    nameCenterY: 0.585,
    // Canto inferior esquerdo: "12/204 • EN • 1".
    footer: { x: 0.02, y: 0.935, w: 0.5, h: 0.06 },
    footerTextH: 0.012,
  },
  finishLabels: { nonfoil: 'normal', foil: 'cold foil', etched: 'especial', '': '' },
  exportWithSet: {
    label: 'Lista com coleção e número (para conferência)',
    line: (count, name, set, number) => `${count} ${name}${number ? ` (${set.toUpperCase().replace(/-\d+$/, '')} ${number})` : ''}`,
  },
  exportPlainLabel: 'Lista — Dreamborn, Inkdecks, Lorcanito ("4 Mickey Mouse - Brave Little Tailor")',
  importHint: 'Para montadores de deck (Dreamborn, Inkdecks…), use a lista simples: "quantidade + nome completo".',
};
