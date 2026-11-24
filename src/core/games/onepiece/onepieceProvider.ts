import { parseIndex } from '../indexFormat';
import type { GameProvider } from '../types';

/**
 * One Piece Card Game. Dados: TCGCSV (cópia diária do TCGplayer) — scripts/onepiece.ts.
 *
 * Na carta (medidas tiradas de uma carta real, em frações da altura):
 * - NOME embaixo, centralizado, em branco sobre a faixa preta (~86%), com
 *   "LEADER"/"CHARACTER" acima e o tipo ("Straw Hat Crew") abaixo;
 * - texto de efeito acima (termina ~80%) — fica de fora da faixa de busca;
 * - CÓDIGO ("OP11-041") no canto inferior direito (~95%), seguido da raridade.
 * Versões alternativas (Parallel, Manga…) têm o mesmo código: o usuário marca
 * qual é (como o foil no Magic).
 */
export const onepieceProvider: GameProvider = {
  id: 'onepiece',
  displayName: 'One Piece Card Game',
  shortName: 'One Piece',
  cardAspect: 63 / 88,
  // Referência de tamanho das letras (mesma escala do Magic).
  nameRegion: { x: 0.3, y: 0.83, w: 0.4, h: 0.065 },
  // Faixa de busca: de 79% a 94% da altura (só a parte de baixo, sem o efeito).
  nameSearchBand: { x: 0, y: 0.79, w: 1, h: 0.15 },
  // Nome centralizado sobre fundo escuro: o leitor de linha olha só o meio da
  // largura (o círculo de LIFE à direita e o símbolo de cor à esquerda atrapalham).
  nameHintSpan: [0.28, 0.72],
  // Na faixa de baixo, o nome é o texto mais alto ("LEADER" e o tipo são menores).
  nameIsTallestText: true,
  // Dígitos/pontuação: "Monkey.D.Luffy", "Mr.1 (Daz.Bonez)", "DON!!".
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',-.&!()",
  indexFile: 'data/onepiece-index.json',
  parseIndex: (json) => parseIndex(json),
  geometry: {
    // Texto claro sobre faixa escura: a "faixa clara" quase nunca é achada e o
    // app usa a silhueta da carta. Valores para quando for.
    barLeft: 0,
    barWidth: 1,
    nameCenterY: 0.862,
    // Canto inferior direito: "OP11-041 L".
    footer: { x: 0.55, y: 0.925, w: 0.43, h: 0.06 },
    footerTextH: 0.02,
  },
  finishLabels: { nonfoil: 'normal', foil: 'parallel', etched: 'especial', '': '' },
  exportWithSet: {
    // Formato dos montadores de deck de One Piece (OPTCGSim e outros): "1xOP11-041".
    label: 'Lista com código — montadores de deck de One Piece (1xOP11-041)',
    line: (count, name, _set, number) => (number ? `${count}x${number}` : `${count} ${name}`),
  },
  exportPlainLabel: 'Lista simples (só nome)',
  importHint:
    'Cole a lista no importador do site ou simulador (ex.: OPTCGSim, deck builders). Versão parallel/especial não entra no código — confira no CSV.',
  liga: {
    siteName: 'LigaOnePiece',
    // "OP11-041" → "OP11".
    setCode: (set, n) => (n?.includes('-') ? n.split('-')[0] : set).toLowerCase().replace(/-\d+$/, ''),
    cardNumber: (n) => n ?? '',
    extras: { foil: 'Parallel', etched: '' },
  },
};
