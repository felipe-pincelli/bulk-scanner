import type { PriceInfo, Printing } from '../games/types';

/**
 * Faixa de preço de um conjunto de impressões (ex.: as versões de UMA edição, ou
 * a impressão exata). Com uma impressão só, mínimo = preço normal (sem foil).
 */
export function priceForPrintings(printings: Printing[]): PriceInfo {
  let minUsd: number | null = null;
  let maxNonfoilUsd: number | null = null;
  let maxUsd: number | null = null;
  let best: Printing | null = null;
  let maxFinish: PriceInfo['maxFinish'] = '';
  for (const p of printings) {
    const base = p.usd ?? p.usdEtched ?? p.usdFoil; // versão "comum" desta impressão
    if (base !== null && (minUsd === null || base < minUsd)) minUsd = base;
    if (p.usd !== null && (maxNonfoilUsd === null || p.usd > maxNonfoilUsd)) maxNonfoilUsd = p.usd;
    for (const [price, finish] of [
      [p.usd, 'nonfoil'],
      [p.usdFoil, 'foil'],
      [p.usdEtched, 'etched'],
    ] as const) {
      if (price !== null && (maxUsd === null || price > maxUsd)) {
        maxUsd = price;
        best = p;
        maxFinish = finish;
      }
    }
  }
  return {
    minUsd,
    maxNonfoilUsd,
    maxUsd,
    maxSet: best?.set ?? '',
    maxSetName: best?.setName ?? '',
    maxFinish,
    printings: printings.length > 1 ? printings : undefined,
  };
}
