import type { PriceInfo, Printing } from '../games/types';

/**
 * Preço de UMA CÓPIA: a mesma carta vale diferente conforme o acabamento e a
 * condição. O app não detecta nenhum dos dois pela câmera; o usuário informa
 * (para o lote todo antes de escanear, ou carta a carta no resumo).
 *
 * Acabamento:
 * - nonfoil: normal
 * - foil:    foil (Magic) / reverse holo ou holo (Pokémon)
 * - etched:  foil etched (Magic) / 1ª edição (Pokémon)
 *
 * Condição: os preços do TCGplayer são de cartas NM (quase perfeitas). Para as
 * demais, aplicamos descontos aproximados, comuns no mercado.
 */
export type Finish = 'nonfoil' | 'foil' | 'etched';
export const FINISHES: Finish[] = ['nonfoil', 'foil', 'etched'];

export type Condition = 'NM' | 'SP' | 'MP' | 'HP' | 'DMG';
export const CONDITIONS: Condition[] = ['NM', 'SP', 'MP', 'HP', 'DMG'];
export const CONDITION_FACTOR: Record<Condition, number> = { NM: 1, SP: 0.85, MP: 0.7, HP: 0.5, DMG: 0.35 };
export const CONDITION_NAME: Record<Condition, string> = {
  NM: 'Near Mint',
  SP: 'Slightly Played',
  MP: 'Moderately Played',
  HP: 'Heavily Played',
  DMG: 'Damaged',
};

export interface CopyInfo {
  finish?: Finish;
  condition?: Condition;
}

export const pickFinish = (p: Printing, f: Finish) => (f === 'nonfoil' ? p.usd : f === 'foil' ? p.usdFoil : p.usdEtched);

/**
 * Ajusta a faixa de preço de uma carta para o acabamento/condição informados.
 * @param printing impressão exata, se a edição foi identificada
 */
export function adjustPrice(price: PriceInfo, copy: CopyInfo, printing?: Printing | null): PriceInfo {
  let { minUsd, maxNonfoilUsd, maxUsd } = price;
  if (copy.finish) {
    const list = printing ? [printing] : (price.printings ?? []);
    const values = list.map((p) => pickFinish(p, copy.finish!)).filter((v): v is number => v !== null);
    if (values.length) {
      minUsd = Math.min(...values);
      maxUsd = maxNonfoilUsd = Math.max(...values);
    } else if (copy.finish === 'nonfoil') {
      maxUsd = maxNonfoilUsd = maxNonfoilUsd ?? minUsd;
    } else if (!list.length && price.maxFinish === copy.finish) {
      minUsd = maxNonfoilUsd = maxUsd; // carta de impressão única: o máximo é desse acabamento
    }
    // Se a carta não existe nesse acabamento (ex.: lote "foil" e veio um Moat, que
    // nunca foi impresso em foil), ela entrou no lote por engano: mantém o preço
    // normal em vez de zerar — melhor do que perder o alerta de uma carta cara.
  }
  const k = copy.condition ? CONDITION_FACTOR[copy.condition] : 1;
  const times = (v: number | null) => (v === null ? null : v * k);
  return { ...price, minUsd: times(minUsd), maxNonfoilUsd: times(maxNonfoilUsd), maxUsd: times(maxUsd) };
}

export const hasCopyInfo = (c: CopyInfo) => !!(c.finish || c.condition);
