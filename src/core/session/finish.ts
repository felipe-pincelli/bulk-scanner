import type { Printing } from '../games/types';
import type { AlertLevel } from '../alerts/alertRules';
import type { SessionEntry } from './session';

/**
 * Acabamento da cópia, escolhido pelo usuário no resumo (o app não detecta foil
 * pela câmera — o brilho depende demais da luz e do ângulo).
 * - nonfoil: normal
 * - foil:    foil (Magic) / reverse holo ou holo (Pokémon)
 * - etched:  foil etched (Magic) / 1ª edição (Pokémon)
 */
export type Finish = 'nonfoil' | 'foil' | 'etched';
export const FINISHES: Finish[] = ['nonfoil', 'foil', 'etched'];

/** Impressões possíveis para esta leitura (a exata, ou as da carta/edição). */
function printingsOf(e: SessionEntry): Printing[] {
  if (e.printing) return [e.printing];
  return e.price?.printings ?? [];
}

const pick = (p: Printing, f: Finish) => (f === 'nonfoil' ? p.usd : f === 'foil' ? p.usdFoil : p.usdEtched);

/** Quais acabamentos têm preço para esta carta (normal sempre aparece). */
export function finishOptions(e: SessionEntry): Finish[] {
  const list = printingsOf(e);
  return FINISHES.filter((f) => f === 'nonfoil' || list.some((p) => pick(p, f) !== null));
}

/**
 * Faixa de preço (US$) da leitura, considerando o acabamento escolhido.
 * Sem escolha: a faixa de sempre (da versão mais barata à mais cara, foil incluso).
 */
export function entryRangeUsd(e: SessionEntry): { min: number | null; max: number | null } {
  const price = e.price;
  if (!e.finish) return { min: price?.minUsd ?? null, max: price?.maxUsd ?? null };
  const values = printingsOf(e)
    .map((p) => pick(p, e.finish!))
    .filter((v): v is number => v !== null);
  if (values.length) return { min: Math.min(...values), max: Math.max(...values) };
  if (e.finish === 'nonfoil') return { min: price?.minUsd ?? null, max: price?.maxNonfoilUsd ?? price?.minUsd ?? null };
  return { min: null, max: null };
}

/**
 * Nível de alerta da leitura. Se o usuário escolheu o acabamento, recalcula pelo
 * preço daquele acabamento (ex.: marcou "foil etched" num Bolt de R$ 5 → vale R$ 70).
 */
export function effectiveLevel(e: SessionEntry, minBrl: number): AlertLevel {
  if (!e.finish || !e.usdBrl || minBrl <= 0) return e.level;
  const { min, max } = entryRangeUsd(e);
  const lo = (min ?? 0) * e.usdBrl;
  const hi = (max ?? 0) * e.usdBrl;
  if (lo >= minBrl * 5) return 'red';
  if (lo >= minBrl) return 'yellow';
  if (hi >= minBrl) return 'check';
  return 'none';
}
