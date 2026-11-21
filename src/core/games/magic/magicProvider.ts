import type { CardIndex, GameProvider, NameEntry, PriceInfo } from '../types';

/** Formato gravado por scripts/build-data.ts. */
interface MagicIndexFile {
  version: number;
  source: string;
  pricesUpdatedAt: string;
  builtAt: string;
  usdBrl: number | null;
  rows: [string, number | null, number | null, number | null, string, string, PriceInfo['maxFinish']][];
  aliases: Record<string, string>;
}

export const magicProvider: GameProvider = {
  id: 'magic',
  displayName: 'Magic: The Gathering',
  cardAspect: 63 / 88,
  // Faixa do nome no frame moderno (usada como referência de tamanho das letras).
  nameRegion: { x: 0.065, y: 0.04, w: 0.72, h: 0.065 },
  // Topo da área de detecção, largura inteira, 28% da altura: aceita a carta um
  // pouco deslocada, menor ou maior que a moldura.
  nameSearchBand: { x: 0, y: 0, w: 1, h: 0.28 },
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',-",
  indexFile: 'data/magic-index.json',

  parseIndex(json): CardIndex {
    const file = json as MagicIndexFile;
    const entries: NameEntry[] = [];
    const prices = new Map<string, PriceInfo>();

    for (const [name, minUsd, maxNonfoilUsd, maxUsd, maxSet, maxSetName, maxFinish] of file.rows) {
      prices.set(name, { minUsd, maxNonfoilUsd, maxUsd, maxSet, maxSetName, maxFinish });
      entries.push({ matchText: name, cardName: name });
      // Cartas de duas faces/split ("Fire // Ice"): na carta física aparece só
      // o nome de uma face, então cada face também vira uma entrada.
      if (name.includes(' // ')) {
        for (const face of name.split(' // ')) entries.push({ matchText: face, cardName: name });
      }
    }
    // Nomes impressos alternativos (ex.: série Godzilla).
    for (const [alias, name] of Object.entries(file.aliases ?? {})) {
      entries.push({ matchText: alias, cardName: name });
    }

    return {
      entries,
      prices,
      source: file.source,
      pricesUpdatedAt: file.pricesUpdatedAt,
      builtAt: file.builtAt,
      usdBrl: file.usdBrl,
    };
  },
};
