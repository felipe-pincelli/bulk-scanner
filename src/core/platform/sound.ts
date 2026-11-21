import type { AlertLevel } from '../alerts/alertRules';

/**
 * Sons de alerta gerados na hora (Web Audio), sem arquivos de áudio.
 *
 * iPhone: o navegador só libera o som depois de um toque do usuário, por isso
 * `unlock()` precisa ser chamado dentro do clique em "Iniciar sessão".
 * Também pedimos o modo "playback" (Safari 16.4+), que toca mesmo com a chave
 * de silencioso ligada — em versões antigas do iOS, o modo silencioso corta o som.
 */
type Note = [freq: number, startS: number, durS: number];

const PATTERNS: Record<Exclude<AlertLevel, 'none'>, { notes: Note[]; type: OscillatorType; gain: number }> = {
  check: { notes: [[523, 0, 0.09]], type: 'sine', gain: 0.25 },
  yellow: { notes: [[880, 0, 0.12], [1175, 0.13, 0.14]], type: 'square', gain: 0.18 },
  red: {
    notes: [[1047, 0, 0.1], [1397, 0.11, 0.1], [1047, 0.22, 0.1], [1397, 0.33, 0.18]],
    type: 'square',
    gain: 0.22,
  },
};

export class AlertSound {
  private ctx: AudioContext | null = null;
  enabled = true;

  async unlock() {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
    // Toca um som vazio: no iOS isso "destrava" o áudio para os próximos sons.
    const src = this.ctx.createBufferSource();
    src.buffer = this.ctx.createBuffer(1, 1, 22050);
    src.connect(this.ctx.destination);
    src.start();
  }

  play(level: AlertLevel) {
    if (!this.enabled || level === 'none' || !this.ctx) return;
    if (this.ctx.state !== 'running') void this.ctx.resume();
    const { notes, type, gain } = PATTERNS[level];
    const t0 = this.ctx.currentTime + 0.01;
    for (const [freq, start, dur] of notes) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      // Envelope curto para não "estalar".
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(gain, t0 + start + 0.01);
      g.gain.setValueAtTime(gain, t0 + start + dur - 0.02);
      g.gain.linearRampToValueAtTime(0, t0 + start + dur);
      osc.connect(g).connect(this.ctx.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.02);
    }
  }
}
