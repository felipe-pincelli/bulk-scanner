import { subRect, type Rect } from '../camera/geometry';
import type { GameProvider } from '../games/types';
import type { FuzzyMatcher, MatchResult } from '../matching/fuzzyMatcher';
import type { OcrEngine, OcrLine } from '../ocr/ocrEngine';
import { cropForOcr } from '../ocr/preprocess';
import { correctionDeg, ORIENTATIONS, rotateRegion, type Orientation } from './orientation';

/**
 * Laço de leitura contínua: recorta a faixa de busca do quadro atual, roda o OCR,
 * corrige com a lista de nomes e avisa o resultado. Repete sozinho.
 * Não sabe nada de interface — só chama `onRead` a cada leitura.
 *
 * Orientação automática: em cada quadro testa primeiro a orientação que vem
 * funcionando. Só se ela não achar nada, testa mais UMA outra orientação no
 * mesmo quadro (revezando entre as três restantes). Assim, com as cartas sempre
 * na mesma posição, o custo é de uma leitura por quadro; ao mudar a posição,
 * a nova orientação é encontrada em poucos quadros.
 */

export interface ScanRead {
  /** Texto cru de todas as linhas lidas (para diagnóstico). */
  rawText: string;
  /** Nome reconhecido (só se a semelhança passou do mínimo). */
  match: MatchResult | null;
  /** Melhor palpite mesmo abaixo do mínimo — útil para diagnosticar. */
  bestGuess: MatchResult | null;
  /** true quando o mesmo nome foi lido em leituras seguidas (evita falsos positivos). */
  confirmed: boolean;
  orientation: Orientation;
  ocrMs: number;
  matchMs: number;
  crop: HTMLCanvasElement;
}

export interface ScannerOptions {
  video: HTMLVideoElement;
  engine: OcrEngine;
  matcher: FuzzyMatcher | null;
  game: GameProvider;
  /** Área de detecção quadrada, em pixels do vídeo, calculada a cada quadro. */
  getZoneRect: () => Rect | null;
  onRead: (read: ScanRead) => void;
  /** Intervalo mínimo entre leituras (ms). 250 = no máximo 4 por segundo. */
  minIntervalMs?: number;
  minScore?: number;
  readsToConfirm?: number;
  autoRotate?: boolean;
}

/** Altura desejada (px) da faixa do nome depois de redimensionar. */
const NAME_BAND_PX = 46;

export class Scanner {
  private running = false;
  private canvas = document.createElement('canvas');
  private lastName: string | null = null;
  private streak = 0;
  private goodOrientation: Orientation | null = null;
  private attempt = 0;

  constructor(private opts: ScannerOptions) {}

  setMatcher(matcher: FuzzyMatcher | null) {
    this.opts.matcher = matcher;
  }

  setAutoRotate(on: boolean) {
    this.opts.autoRotate = on;
    if (!on) this.goodOrientation = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
  }

  /** Próxima orientação "de busca" (revezamento), diferente da que já foi testada. */
  private nextOther(exclude?: Orientation): Orientation {
    let o: Orientation;
    do o = ORIENTATIONS[this.attempt++ % 4];
    while (o === exclude);
    return o;
  }

  private async loop() {
    const { minIntervalMs = 250, minScore = 0.75, readsToConfirm = 2, game } = this.opts;
    while (this.running) {
      const started = performance.now();
      const zone = this.opts.getZoneRect();
      const { video } = this.opts;
      if (zone && video.videoWidth > 0 && zone.w > 20) {
        const first: Orientation = this.opts.autoRotate ? (this.goodOrientation ?? this.nextOther()) : 0;
        const plan = this.opts.autoRotate ? [first, this.nextOther(first)] : [first];

        let orientation = first;
        let lines: OcrLine[] = [];
        let best: MatchResult | null = null;
        let crop = this.canvas;
        let ocrMs = 0;
        let matchMs = 0;
        for (const o of plan) {
          const band = subRect(zone, rotateRegion(game.nameSearchBand, o));
          // Escala para a faixa do nome ficar com ~NAME_BAND_PX de altura.
          const scale = Math.min(2, NAME_BAND_PX / (game.nameRegion.h * zone.h));
          crop = cropForOcr(video, band, this.canvas, { rotateDeg: correctionDeg(o), scale });
          const t0 = performance.now();
          lines = await this.opts.engine.readLines(crop);
          const t1 = performance.now();
          best = null;
          for (const line of lines) {
            const m = this.opts.matcher?.match(line.text) ?? null;
            if (m && (!best || m.score > best.score)) best = m;
          }
          ocrMs += t1 - t0;
          matchMs += performance.now() - t1;
          orientation = o;
          if (best && best.score >= minScore) break;
        }
        const match = best && best.score >= minScore ? best : null;
        if (match) this.goodOrientation = orientation;

        if (match && match.cardName === this.lastName) this.streak++;
        else this.streak = match ? 1 : 0;
        this.lastName = match?.cardName ?? null;

        this.opts.onRead({
          rawText: lines.map((l) => l.text).join(' | '),
          match,
          bestGuess: best,
          confirmed: this.streak >= readsToConfirm,
          orientation,
          ocrMs,
          matchMs,
          crop,
        });
      }
      const wait = minIntervalMs - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}
