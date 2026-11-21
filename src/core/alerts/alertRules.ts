import type { PriceInfo } from '../games/types';

/**
 * Decide se uma carta merece alerta, e de que nível.
 *
 * Níveis:
 * - red    → valor ≥ 5× o mínimo
 * - yellow → valor ≥ mínimo
 * - check  → "confira a edição": só alguma impressão específica vale o mínimo
 *            (só no critério "seguro")
 *
 * Critérios ("basis"):
 * - safe (seguro): compara o preço da impressão MAIS BARATA. Se ela já vale o
 *   mínimo, qualquer cópia vale → alerta de verdade. Se só a mais cara vale,
 *   avisa de leve ("confira a edição").
 * - max (qualquer edição): compara o preço da impressão MAIS CARA (critério
 *   original). Dispara muito mais, inclusive para cartas baratas com um promo caro.
 */
export type AlertLevel = 'none' | 'check' | 'yellow' | 'red';
export type AlertBasis = 'safe' | 'max';

export interface AlertSettings {
  minBrl: number;
  basis: AlertBasis;
  /** Considerar impressões foil no preço máximo. */
  includeFoil: boolean;
  /** Mostrar o aviso leve "confira a edição" (critério seguro). */
  checkCue: boolean;
}

export interface AlertDecision {
  level: AlertLevel;
  /** Valor em R$ que motivou o alerta (para mostrar na tela). */
  valueBrl: number | null;
}

const NONE: AlertDecision = { level: 'none', valueBrl: null };

export function evaluateAlert(price: PriceInfo | undefined, usdBrl: number | null, s: AlertSettings): AlertDecision {
  if (!price || !usdBrl || s.minBrl <= 0) return NONE;
  const toBrl = (usd: number | null) => (usd === null ? null : usd * usdBrl);
  const maxBrl = toBrl(s.includeFoil ? price.maxUsd : (price.maxNonfoilUsd ?? price.maxUsd));
  const minBrl = toBrl(price.minUsd);

  const basis = s.basis === 'safe' ? minBrl : maxBrl;
  if (basis !== null && basis >= s.minBrl * 5) return { level: 'red', valueBrl: basis };
  if (basis !== null && basis >= s.minBrl) return { level: 'yellow', valueBrl: basis };
  if (s.basis === 'safe' && s.checkCue && maxBrl !== null && maxBrl >= s.minBrl) {
    return { level: 'check', valueBrl: maxBrl };
  }
  return NONE;
}
