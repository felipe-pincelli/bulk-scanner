import { parseIndex } from '../indexFormat';
import type { GameProvider } from '../types';

/**
 * Pokémon TCG. Dados: TCGCSV (cópia diária do TCGplayer) — scripts/pokemon.ts.
 *
 * Na carta: o nome fica no topo à esquerda (às vezes ao lado de "BASIC"/"STAGE 1"
 * e com o HP à direita — o corretor de nomes ignora essas sobras). O número de
 * colecionador com o total da coleção ("063/198") fica embaixo: à esquerda nas
 * cartas recentes, à direita nas antigas — por isso o rodapé é lido na largura toda.
 */
export const pokemonProvider: GameProvider = {
  id: 'pokemon',
  displayName: 'Pokémon TCG',
  shortName: 'Pokémon',
  cardAspect: 63 / 88,
  nameRegion: { x: 0.08, y: 0.035, w: 0.6, h: 0.06 },
  nameSearchBand: { x: 0, y: 0, w: 1, h: 0.28 },
  // Dígitos e "." / "&": "Porygon2", "Mr. Mime", "Pikachu & Zekrom-GX".
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',-.&",
  indexFile: 'data/pokemon-index.json',
  parseIndex: (json) => parseIndex(json),
  geometry: {
    // A área clara do topo costuma ir de borda a borda da carta.
    barLeft: 0,
    barWidth: 1,
    nameCenterY: 0.065,
    footer: { x: 0.02, y: 0.885, w: 0.96, h: 0.105 },
    footerTextH: 0.011,
  },
  finishLabels: { nonfoil: 'normal', foil: 'reverse holo', etched: '1ª edição', '': '' },
  exportWithSet: {
    // Formato do Pokémon TCG Live / Limitless: "1 Pikachu SVI 63".
    label: 'Lista com edição — formato Pokémon TCG Live / Limitless',
    line: (count, name, set, number) => {
      const n = number ? ` ${number.split('/')[0].replace(/^0+(?=\d)/, '')}` : '';
      return `${count} ${name} ${set.toUpperCase().replace(/-\d+$/, '')}${n}`;
    },
  },
  exportPlainLabel: 'Lista simples (só nome)',
  importHint: 'Cole a lista no importador do site ou app (ex.: Pokémon TCG Live, Limitless, TCGplayer). Siglas de coleção vêm do TCGplayer e podem diferir em alguns sites.',
  liga: {
    siteName: 'LigaPokémon',
    // Sigla do TCGplayer (pode diferir da Liga em algumas coleções).
    setCode: (set) => set.toLowerCase().replace(/-\d+$/, ''),
    cardNumber: (n) => (n ? n.split('/')[0].replace(/^0+(?=\d)/, '') : ''),
    extras: { foil: 'Reverse Foil', etched: '1ª Edição' },
  },
};
