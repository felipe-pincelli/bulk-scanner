import type { Printing } from '../games/types';
import type { AlertLevel } from '../alerts/alertRules';
import { adjustPrice, FINISHES, pickFinish, type Finish } from '../prices/copyPrice';
import type { SessionEntry } from './session';

export { FINISHES, CONDITIONS, type Finish, type Condition } from '../prices/copyPrice';

/** Impressões possíveis para esta leitura (a exata, ou as da carta/edição). */
function printingsOf(e: SessionEntry): Printing[] {
  if (e.printing) return [e.printing];
  return e.price?.printings ?? [];
}

/** Quais acabamentos têm preço para esta carta (normal sempre aparece). */
export function finishOptions(e: SessionEntry): Finish[] {
  const list = printingsOf(e);
  const single = !list.length && e.price?.maxFinish;
  return FINISHES.filter((f) => f === 'nonfoil' || list.some((p) => pickFinish(p, f) !== null) || single === f);
}

/**
 * Faixa de preço (US$) da leitura, considerando acabamento e condição informados.
 * Sem nada informado: a faixa de sempre (da versão mais barata à mais cara).
 */
export function entryRangeUsd(e: SessionEntry): { min: number | null; max: number | null } {
  if (!e.price) return { min: null, max: null };
  const p = adjustPrice(e.price, { finish: e.finish, condition: e.condition }, e.printing);
  return { min: p.minUsd, max: p.maxUsd };
}

/**
 * Nível de alerta da leitura. Se o usuário informou acabamento ou condição,
 * recalcula pelo preço da cópia (ex.: marcou "foil etched" num Bolt de R$ 5 →
 * vale R$ 70; marcou "HP" numa carta de R$ 12 → vale ~R$ 6).
 */
export function effectiveLevel(e: SessionEntry, minBrl: number): AlertLevel {
  if ((!e.finish && !e.condition) || !e.usdBrl || minBrl <= 0) return e.level;
  const { min, max } = entryRangeUsd(e);
  const lo = (min ?? 0) * e.usdBrl;
  const hi = (max ?? 0) * e.usdBrl;
  if (lo >= minBrl * 5) return 'red';
  if (lo >= minBrl) return 'yellow';
  if (hi >= minBrl) return 'check';
  return 'none';
}
