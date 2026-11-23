import { subRect, type Rect } from '../camera/geometry';
import type { GameProvider, Printing } from '../games/types';
import { estimateCard, footerRegion, ghostCard } from '../edition/footer';
import { parseFooter, type EditionResult } from '../edition/parseFooter';
import { identifyByFooter, type FooterIndex } from '../edition/footerIndex';
import { normalize, weightedLength, type FuzzyMatcher, type MatchResult } from '../matching/fuzzyMatcher';
import type { OcrEngine, OcrLine } from '../ocr/ocrEngine';
import { cropForOcr, findTextRow, PAD } from '../ocr/preprocess';
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
  /**
   * Modo "pelo rodapé" (cartas em japonês, phyrexiano…): se devolver um catálogo,
   * a carta é identificada SÓ pela edição + número do rodapé, sem ler o nome.
   */
  getFooterIndex?: () => FooterIndex | null;
  /** Se devolver um catálogo: quando o nome não for reconhecido, tenta o rodapé. */
  getFooterFallback?: () => FooterIndex | null;
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
function pickBest(lines: OcrLine[], matcher: FuzzyMatcher | null, minScore: number, joinLines = false): MatchResult | null {
  let bestLong: MatchResult | null = null;
  let bestShort: MatchResult | null = null;
  // Nome em duas linhas (Lorcana): também testa cada linha junto com a seguinte.
  const candidates: OcrLine[] = joinLines
    ? [
        ...lines,
        ...lines.slice(0, -1).map((l, i) => ({
          text: `${l.text} ${lines[i + 1].text}`,
          confidence: Math.min(l.confidence, lines[i + 1].confidence),
        })),
      ]
    : lines;
  for (const line of candidates) {
    const m = matcher?.match(line.text) ?? null;
    if (!m) continue;
    const len = weightedLength(normalize(m.matchText));
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
  private subCanvas = document.createElement('canvas');
  private footerUseBar = true;
  private footerMisses = 0;
  private subCanvas2 = document.createElement('canvas');
  private subCanvas3 = document.createElement('canvas');
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

  /** Uma leitura no modo "pelo rodapé": acha a carta, lê o rodapé e consulta o catálogo. */
  private async scanByFooter(video: HTMLVideoElement, zone: Rect, index: FooterIndex) {
    const { game, readsToConfirm = 2 } = this.opts;
    const first: Orientation = this.opts.autoRotate ? (this.goodOrientation ?? this.nextOther()) : 0;
    const plan = this.opts.autoRotate ? [first, this.nextOther(first)] : [first];
    let hit: ReturnType<typeof identifyByFooter> = null;
    let orientation = first;
    let text = '';
    let crop = this.footerCanvas;
    let ocrMs = 0;
    for (const o of plan) {
      orientation = o;
      const r = await this.footerAttempt(video, zone, o, index);
      ocrMs += r.ms;
      text = r.text;
      if (r.crop) crop = r.crop;
      hit = r.hit;
      if (hit) break;
    }
    if (hit) this.goodOrientation = orientation;
    // Um quadro sem leitura no meio não zera a confirmação (o rodapé é pequeno e
    // às vezes falha num quadro); só 3 falhas seguidas contam como "a carta saiu".
    if (hit) {
      this.footerMisses = 0;
      if (hit.cardName === this.lastName) this.streak++;
      else this.streak = 1;
      this.lastName = hit.cardName;
    } else if (++this.footerMisses >= 3) {
      this.streak = 0;
      this.lastName = null;
    }
    const match = hit ? { cardName: hit.cardName, matchText: hit.cardName, score: 1 } : null;
    this.opts.onRead({
      rawText: text.replace(/\s+/g, ' ').trim(),
      match,
      bestGuess: match,
      confirmed: this.streak >= readsToConfirm,
      orientation,
      ocrMs,
      matchMs: 0,
      crop,
      edition: hit
        ? {
            cardName: hit.cardName,
            result: { printing: hit.printing, set: hit.printing.set, candidates: [hit.printing] },
            done: true,
            attempts: 1,
            crop,
            rawText: text,
          }
        : undefined,
    });
  }

  /** Uma tentativa de identificar a carta pelo rodapé, numa orientação. */
  private async footerAttempt(video: HTMLVideoElement, zone: Rect, o: Orientation, index: FooterIndex) {
    const { game } = this.opts;
    // Onde está a carta: pela faixa do nome (sem precisar ler o nome — basta
    // achar a barra) ou pela silhueta na tela.
    const scale = Math.min(2, NAME_BAND_PX / (game.nameRegion.h * zone.h));
    const band = cropForOcr(video, subRect(zone, rotateRegion(game.nameSearchBand, o)), this.subCanvas, {
      rotateDeg: correctionDeg(o),
      scale,
    });
    const hint = findTextRow(band, NAME_BAND_PX * 0.45, game.nameHintSpan, game.nameIsTallestText);
    const fromBar = estimateCard(hint, game.nameSearchBand, scale * zone.w, game.geometry, game.cardAspect);
    // Fica com a estimativa que funcionou da última vez; troca só quando falha.
    const useBar = !!fromBar && this.footerUseBar;
    const card = useBar ? fromBar! : ghostCard(game.cardAspect);
    const region = footerRegion(card, game.geometry, useBar ? 0 : (game.geometry.footerSlack ?? 0.06));
    if (!region) return { hit: null, text: '', crop: null, ms: 0 };
    const footerScale = Math.min(4, FOOTER_TEXT_PX / (game.geometry.footerTextH * card.h * zone.h));
    const crop = cropForOcr(video, subRect(zone, rotateRegion(region, o)), this.footerCanvas, {
      rotateDeg: correctionDeg(o),
      scale: footerScale,
      invertIfDark: true,
      localBinarizePx: FOOTER_TEXT_PX,
    });
    const t0 = performance.now();
    const text = await this.opts.engine.readFooter(crop);
    const ms = performance.now() - t0;
    const hit = identifyByFooter(text, index);
    if (!hit) this.footerUseBar = !this.footerUseBar;
    return { hit, text, crop, ms };
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
    const useBar = !!fromBar && state.attempts % 2 === 1;
    const card = useBar ? fromBar! : ghostCard(game.cardAspect);
    const region = footerRegion(card, game.geometry, useBar ? 0 : (game.geometry.footerSlack ?? 0.06));
    if (region) {
      const rect = subRect(zone, rotateRegion(region, orientation));
      const footerScale = Math.min(4, FOOTER_TEXT_PX / (game.geometry.footerTextH * card.h * zone.h));
      crop = cropForOcr(video, rect, this.footerCanvas, {
        rotateDeg: correctionDeg(orientation),
        scale: footerScale,
        invertIfDark: true,
        localBinarizePx: FOOTER_TEXT_PX,
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
      const footerIndex = this.opts.getFooterIndex?.() ?? null;
      if (zone && video.videoWidth > 0 && zone.w > 20 && footerIndex) {
        await this.scanByFooter(video, zone, footerIndex);
      } else if (zone && video.videoWidth > 0 && zone.w > 20) {
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
          // Lorcana: a versão ("Brave Little Tailor") fica na linha logo abaixo do
          // nome, muitas vezes em texto claro sobre uma fita colorida, que os
          // leitores da faixa inteira não pegam. Lê essa linha à parte e junta.
          if (game.nameJoinsLines && hint) {
            const nameLine = lines.find((l) => l.fromHint);
            // A linha da versão é a próxima linha de texto abaixo do nome (achada
            // junto com a dica). Largura: a área útil do jogo — a versão pode ser
            // mais longa que o nome (ex.: "ELSA" / "Spirit of Winter").
            const span = game.nameHintSpan ?? [0, 1];
            const usable = crop.width - 2 * PAD;
            const below = hint.below
              ? cropForOcr(
                  crop,
                  { x: PAD + span[0] * usable, y: hint.below.top, w: (span[1] - span[0]) * usable, h: hint.below.height },
                  this.subCanvas,
                  { rotateDeg: 0, scale: 1 },
                )
              : null;
            const row = below ? { top: 0, height: below.height } : null;
            // Lê nas duas polaridades (texto escuro ou claro na fita), com preto e
            // branco local (fita, texto e fundo têm tons diferentes). As duas leituras
            // vão para o corretor de nomes, que fica com a que bater com um nome real.
            const versions: OcrLine[] = [];
            let versionImg: HTMLCanvasElement | null = null;
            if (row) {
              const rect = { x: 0, y: row.top, w: below!.width, h: row.height };
              for (const [invert, canvas] of [
                [false, this.subCanvas2],
                [true, this.subCanvas3],
              ] as const) {
                const img = cropForOcr(below!, rect, canvas, { rotateDeg: 0, scale: 1, invert, localBinarizePx: row.height * 0.2 }); // vizinhança ~ altura das letras
                const read = await this.opts.engine.readSingleLine(img);
                if (read) {
                  versions.push(read);
                  versionImg = img;
                }
              }
            }
            const version = versions[0] ?? null;
            // Diagnóstico (desligado no uso normal): permite inspecionar os recortes.
            (globalThis as { __bsDebug?: (k: string, v: unknown) => void }).__bsDebug?.('version', {
              below: below?.toDataURL(),
              row,
              img: versionImg?.toDataURL(),
              text: versions.map((v) => v.text).join(' / '),
            });
            if (nameLine) {
              for (const v of versions) {
                // As bordas da fita viram "1", "I", "|" no começo/fim: tira os
                // caracteres soltos das pontas.
                const words = v.text.split(/\s+/);
                while (words.length && words[0].length <= 1) words.shift();
                while (words.length && words[words.length - 1].length <= 1) words.pop();
                if (!words.length) continue;
                lines = [...lines, { text: `${nameLine.text} ${words.join(' ')}`, confidence: Math.min(nameLine.confidence, v.confidence) }];
              }
            }
          }
          const t1 = performance.now();
          best = pickBest(lines, this.opts.matcher, minScore, game.nameJoinsLines);
          ocrMs += t1 - t0;
          matchMs += performance.now() - t1;
          orientation = o;
          usedHint = hint;
          usedScale = scale;
          if (best && best.score >= minScore) break;
        }
        let match = best && best.score >= minScore ? best : null;
        // Reserva (ex.: lote japonês): nome não reconhecido → tenta o rodapé.
        let footerEdition: EditionRead | undefined;
        const fallback = !match ? (this.opts.getFooterFallback?.() ?? null) : null;
        if (fallback) {
          const t0 = performance.now();
          // Primeiro na orientação principal; se não achar, na "de busca" do quadro
          // (que se reveza entre as outras), para não ficar presa numa orientação.
          let r = await this.footerAttempt(video, zone, first, fallback);
          let ro = first;
          if (!r.hit && plan.length > 1) {
            ro = plan[1];
            r = await this.footerAttempt(video, zone, ro, fallback);
          }
          ocrMs += performance.now() - t0;
          if (r.hit) {
            orientation = ro;
            this.goodOrientation = ro;
            match = best = { cardName: r.hit.cardName, matchText: r.hit.cardName, score: 1 };
            footerEdition = {
              cardName: r.hit.cardName,
              result: { printing: r.hit.printing, set: r.hit.printing.set, candidates: [r.hit.printing] },
              done: true,
              attempts: 1,
              crop: r.crop,
              rawText: r.text,
            };
          }
        }
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
        const printings = match && !footerEdition && this.opts.needsEdition?.(match.cardName);
        if (footerEdition) edition = footerEdition;
        else if (match && printings && this.edition && !this.edition.done) {
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
