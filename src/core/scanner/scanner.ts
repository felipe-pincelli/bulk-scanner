import type { Rect } from '../camera/geometry';
import type { FuzzyMatcher, MatchResult } from '../matching/fuzzyMatcher';
import type { OcrEngine } from '../ocr/ocrEngine';
import { cropForOcr } from '../ocr/preprocess';

/**
 * Laço de leitura contínua: recorta o nome do quadro atual, roda o OCR,
 * corrige com a lista de nomes e avisa o resultado. Repete sozinho.
 * Não sabe nada de interface — só chama `onRead` a cada leitura.
 */

export interface ScanRead {
  rawText: string;
  ocrConfidence: number;
  /** Nome reconhecido (só se a semelhança passou do mínimo). */
  match: MatchResult | null;
  /** Melhor palpite mesmo abaixo do mínimo — útil para diagnosticar. */
  bestGuess: MatchResult | null;
  /** true quando o mesmo nome foi lido em leituras seguidas (evita falsos positivos). */
  confirmed: boolean;
  ocrMs: number;
  matchMs: number;
  crop: HTMLCanvasElement;
}

export interface ScannerOptions {
  video: HTMLVideoElement;
  engine: OcrEngine;
  matcher: FuzzyMatcher | null;
  /** Retângulo do nome, em pixels do vídeo, calculado a cada quadro. */
  getNameRect: () => Rect | null;
  onRead: (read: ScanRead) => void;
  /** Intervalo mínimo entre leituras (ms). 250 = no máximo 4 por segundo. */
  minIntervalMs?: number;
  minScore?: number;
  readsToConfirm?: number;
}

export class Scanner {
  private running = false;
  private canvas = document.createElement('canvas');
  private lastName: string | null = null;
  private streak = 0;

  constructor(private opts: ScannerOptions) {}

  setMatcher(matcher: FuzzyMatcher | null) {
    this.opts.matcher = matcher;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  private async loop() {
    const { minIntervalMs = 250, minScore = 0.72, readsToConfirm = 2 } = this.opts;
    while (this.running) {
      const started = performance.now();
      const rect = this.opts.getNameRect();
      const { video } = this.opts;
      if (rect && video.videoWidth > 0 && rect.w > 4 && rect.h > 4) {
        const crop = cropForOcr(video, rect, this.canvas);
        const t0 = performance.now();
        const ocr = await this.opts.engine.readLine(crop);
        const t1 = performance.now();
        const m = this.opts.matcher?.match(ocr.text) ?? null;
        const match = m && m.score >= minScore ? m : null;
        const t2 = performance.now();

        if (match && match.cardName === this.lastName) this.streak++;
        else this.streak = match ? 1 : 0;
        this.lastName = match?.cardName ?? null;

        this.opts.onRead({
          rawText: ocr.text,
          ocrConfidence: ocr.confidence,
          match,
          bestGuess: m,
          confirmed: this.streak >= readsToConfirm,
          ocrMs: t1 - t0,
          matchMs: t2 - t1,
          crop,
        });
      }
      const wait = minIntervalMs - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}
