import { subRect, type Rect } from '../camera/geometry';
import type { GameProvider, Printing } from '../games/types';
import { estimateCard, footerRegion, ghostCard } from '../edition/footer';
import { parseFooter, type EditionResult } from '../edition/parseFooter';
import { normalize, type FuzzyMatcher, type MatchResult } from '../matching/fuzzyMatcher';
import type { OcrEngine, OcrLine } from '../ocr/ocrEngine';
import { cropForOcr, findTextRow } from '../ocr/preprocess';
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
 *
 * Edição: quando uma carta reconhecida precisa da edição para saber o preço
 * (opção `needsEdition`), o laço também lê o rodapé da carta por algumas leituras,
 * até identificar a edição ou desistir.
 */

export interface EditionRead {
  cardName: string;
  /** Resultado da última tentativa (null = não deu para ler). */
  result: EditionResult | null;
  /** true quando a edição foi identificada OU as tentativas acabaram. */
  done: boolean;
  attempts: number;
  /** Recorte do rodapé enviado ao OCR (diagnóstico). */
  crop: HTMLCanvasElement | null;
  /** Texto cru lido no rodapé (diagnóstico). */
  rawText: string;
}

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
  /** Presente nas leituras em que o rodapé foi lido. */
  edition?: EditionRead;
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
  /**
   * Devolve as impressões da carta se vale a pena ler a edição no rodapé (preço
   * depende da edição); senão null.
   */
  needsEdition?: (cardName: string) => Printing[] | null;
}

/** Tentativas de ler o rodapé por carta (cada uma ~uma leitura extra). */
const EDITION_ATTEMPTS = 4;
/** Altura desejada (px) das letras do rodapé depois de ampliar. */
const FOOTER_TEXT_PX = 26;

/** Nomes curtos (< 5 letras) exigem leitura confiante — são fáceis de "inventar". */
const SHORT_NAME = 5;
const SHORT_MIN_CONFIDENCE = 75;
/** Na leitura "uma linha" da dica, o texto é mais confiável. */
const SHORT_MIN_CONFIDENCE_HINT = 40;
/** Nomes médios (5 a 7 letras) exigem semelhança maior: lixo parecido é comum. */
const MEDIUM_NAME = 8;
const MEDIUM_MIN_SCORE = 0.88;

/**
 * Escolhe o melhor nome entre as linhas lidas. Regras contra falsos positivos:
 * - nome curto só vale se o OCR estava confiante naquela linha;
 * - nome médio precisa de semelhança alta;
 * - um nome longo bem reconhecido sempre ganha de um curto.
 */
function pickBest(lines: OcrLine[], matcher: FuzzyMatcher | null, minScore: number): MatchResult | null {
  let bestLong: MatchResult | null = null;
  let bestShort: MatchResult | null = null;
  for (const line of lines) {
    const m = matcher?.match(line.text) ?? null;
    if (!m) continue;
    const len = normalize(m.matchText).length;
    if (len < SHORT_NAME) {
      const minConf = line.fromHint ? SHORT_MIN_CONFIDENCE_HINT : SHORT_MIN_CONFIDENCE;
      if (line.confidence >= minConf && (!bestShort || m.score > bestShort.score)) bestShort = m;
      continue;
    }
    if (len < MEDIUM_NAME && m.score < MEDIUM_MIN_SCORE) continue;
    if (!bestLong || m.score > bestLong.score) bestLong = m;
  }
  if (bestLong && bestLong.score >= minScore) return bestLong;
  return bestShort ?? bestLong;
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
  private footerCanvas = document.createElement('canvas');
  /** Estado da leitura de edição da carta atual. */
  private edition: { cardName: string; attempts: number; done: boolean } | null = null;
  private absentReads = 0;

  constructor(private opts: ScannerOptions) {}

  setMatcher(matcher: FuzzyMatcher | null) {
    this.opts.matcher = matcher;
  }

  /** Troca o jogo (só com a leitura parada). */
  setGame(game: GameProvider) {
    this.opts.game = game;
    this.edition = null;
    this.lastName = null;
    this.streak = 0;
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

  private async readEdition(
    video: HTMLVideoElement,
    zone: Rect,
    orientation: Orientation,
    hint: ReturnType<typeof findTextRow>,
    scale: number,
    printings: Printing[],
  ): Promise<EditionRead> {
    const state = this.edition!;
    state.attempts++;
    let result: EditionResult | null = null;
    let crop: HTMLCanvasElement | null = null;
    let rawText = '';
    const { game } = this.opts;
    // Tamanho/posição da carta: pela faixa do nome; senão, pela silhueta na tela.
    // Alterna entre os dois nas tentativas, caso a primeira estimativa erre.
    const fromBar = estimateCard(hint, game.nameSearchBand, scale * zone.w, game.geometry, game.cardAspect);
    const card = fromBar && state.attempts % 2 === 1 ? fromBar : ghostCard(game.cardAspect);
    const region = footerRegion(card, game.geometry);
    if (region) {
      const rect = subRect(zone, rotateRegion(region, orientation));
      const footerScale = Math.min(4, FOOTER_TEXT_PX / (game.geometry.footerTextH * card.h * zone.h));
      crop = cropForOcr(video, rect, this.footerCanvas, {
        rotateDeg: correctionDeg(orientation),
        scale: footerScale,
        invertIfDark: true,
      });
      rawText = await this.opts.engine.readFooter(crop);
      result = parseFooter(rawText, printings);
    }
    if (result?.printing || state.attempts >= EDITION_ATTEMPTS) state.done = true;
    return { cardName: state.cardName, result, done: state.done, attempts: state.attempts, crop, rawText };
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
        let usedHint: ReturnType<typeof findTextRow> = null;
        let usedScale = 1;
        for (const o of plan) {
          const band = subRect(zone, rotateRegion(game.nameSearchBand, o));
          // Escala para a faixa do nome ficar com ~NAME_BAND_PX de altura.
          const scale = Math.min(2, NAME_BAND_PX / (game.nameRegion.h * zone.h));
          crop = cropForOcr(video, band, this.canvas, { rotateDeg: correctionDeg(o), scale });
          const t0 = performance.now();
          // Altura aproximada das letras no recorte (~45% da faixa do nome).
          const hint = findTextRow(crop, NAME_BAND_PX * 0.45, game.nameHintSpan, game.nameIsTallestText);
          lines = await this.opts.engine.readLines(crop, hint);
          const t1 = performance.now();
          best = pickBest(lines, this.opts.matcher, minScore);
          ocrMs += t1 - t0;
          matchMs += performance.now() - t1;
          orientation = o;
          usedHint = hint;
          usedScale = scale;
          if (best && best.score >= minScore) break;
        }
        const match = best && best.score >= minScore ? best : null;
        if (match) this.goodOrientation = orientation;

        if (match && match.cardName === this.lastName) this.streak++;
        else this.streak = match ? 1 : 0;
        this.lastName = match?.cardName ?? null;

        // ---- Edição (rodapé) ----
        this.absentReads = match ? 0 : this.absentReads + 1;
        if (this.absentReads >= 4) this.edition = null; // a carta saiu da câmera
        let edition: EditionRead | undefined;
        if (match && this.edition?.cardName !== match.cardName) {
          this.edition = { cardName: match.cardName, attempts: 0, done: false };
        }
        const printings = match && this.opts.needsEdition?.(match.cardName);
        if (match && printings && this.edition && !this.edition.done) {
          const t0 = performance.now();
          edition = await this.readEdition(video, zone, orientation, usedHint, usedScale, printings);
          ocrMs += performance.now() - t0;
        }

        this.opts.onRead({
          rawText: lines.map((l) => l.text).join(' | '),
          match,
          bestGuess: best,
          confirmed: this.streak >= readsToConfirm,
          orientation,
          ocrMs,
          matchMs,
          crop,
          edition,
        });
      }
      const wait = minIntervalMs - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  }
}
