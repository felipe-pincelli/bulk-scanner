import type { AlertLevel } from '../alerts/alertRules';
import { AlertSound } from './sound';

/**
 * Ponto único de "avisar o usuário" (exceto o flash, que é visual e fica na UI).
 * Hoje: som. Quando o app for empacotado com Capacitor, basta criar outra
 * implementação deste contrato que também vibra (Haptics) — o resto não muda.
 */
export interface Feedback {
  /** Chamar dentro de um toque do usuário (exigência do iOS para áudio). */
  unlock(): Promise<void>;
  alert(level: AlertLevel): void;
  setSoundEnabled(on: boolean): void;
}

export function createWebFeedback(): Feedback {
  const sound = new AlertSound();
  return {
    unlock: () => sound.unlock(),
    alert: (level) => sound.play(level),
    setSoundEnabled: (on) => {
      sound.enabled = on;
    },
  };
}
