import type { CardIndex, NameEntry, PriceInfo, Printing } from './types';

/**
 * Formato do índice gerado por scripts/lib/indexBuilder.ts — igual para todos os
 * jogos. Cada linha: [nome, mín, máx sem foil, máx, edição da mais cara, nome da
 * edição, acabamento, impressões?].
 */
export interface IndexFile {
  version: number;
  game: string;
  source: string;
  pricesUpdatedAt: string;
  builtAt: string;
  usdBrl: number | null;
  rows: [
    string,
    number | null,
    number | null,
    number | null,
    string,
    string,
    PriceInfo['maxFinish'],
    [string, string, number | null, number | null, number | null][]?,
  ][];
  aliases: Record<string, string>;
  sets?: Record<string, string>;
}

export function parseIndex(json: unknown, opts: { splitFaces?: boolean } = {}): CardIndex {
  const file = json as IndexFile;
  const entries: NameEntry[] = [];
  const prices = new Map<string, PriceInfo>();
  const sets = file.sets ?? {};

  for (const [name, minUsd, maxNonfoilUsd, maxUsd, maxSet, maxSetName, maxFinish, rawPrintings] of file.rows) {
    const printings: Printing[] | undefined = rawPrintings?.map(([set, number, usd, usdFoil, usdEtched]) => ({
      set,
      setName: sets[set] ?? set.toUpperCase(),
      number,
      usd,
      usdFoil,
      usdEtched,
    }));
    prices.set(name, { minUsd, maxNonfoilUsd, maxUsd, maxSet, maxSetName, maxFinish, printings });
    entries.push({ matchText: name, cardName: name });
    // Cartas de duas faces/split ("Fire // Ice"): na carta física aparece só o
    // nome de uma face, então cada face também vira uma entrada.
    if (opts.splitFaces && name.includes(' // ')) {
      for (const face of name.split(' // ')) entries.push({ matchText: face, cardName: name });
    }
  }
  // Nomes impressos alternativos (ex.: série Godzilla no Magic).
  for (const [alias, name] of Object.entries(file.aliases ?? {})) entries.push({ matchText: alias, cardName: name });

  return {
    entries,
    prices,
    source: file.source,
    pricesUpdatedAt: file.pricesUpdatedAt,
    builtAt: file.builtAt,
    usdBrl: file.usdBrl,
  };
}
