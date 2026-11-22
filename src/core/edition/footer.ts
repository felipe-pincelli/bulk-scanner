import type { CardGeometry, Region } from '../games/types';
import { PAD, type LineHint } from '../ocr/preprocess';

/**
 * Onde fica o rodapé da carta (número de colecionador + código da edição).
 *
 * O app já acha a faixa do NOME. Como as proporções da carta são fixas
 * (CardGeometry de cada jogo), a largura e a posição dessa faixa dizem o tamanho
 * e a posição da carta — e daí, onde fica o rodapé. Se a faixa não for achada,
 * usa a silhueta da carta desenhada na tela (supondo a carta encaixada nela).
 *
 * Tudo aqui é em frações da área de detecção quadrada, com a carta EM PÉ (antes
 * de aplicar a orientação).
 */
export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Estima a carta a partir da dica de linha do nome.
 * @param hint      dica encontrada no recorte da faixa de busca (pixels do recorte)
 * @param band      faixa de busca (frações da área, carta em pé)
 * @param scalePx   pixels do recorte por fração da área (= escala × lado da área em px)
 */
export function estimateCard(
  hint: LineHint | null,
  band: Region,
  scalePx: number,
  geo: CardGeometry,
  aspect: number,
): CardBox | null {
  if (!hint?.barFound) return null;
  const barLeft = band.x + (hint.left - PAD) / scalePx;
  const barWidth = hint.width / scalePx;
  const textCenter = band.y + (hint.top + hint.height / 2 - PAD) / scalePx;
  const w = barWidth / geo.barWidth;
  const h = w / aspect;
  // Sanidade: a carta tem que ter um tamanho plausível dentro da área.
  if (w < 0.25 || w > 1.05) return null;
  return { x: barLeft - geo.barLeft * w, y: textCenter - geo.nameCenterY * h, w, h };
}

/** A silhueta desenhada na tela: carta em pé, altura total da área, centralizada. */
export function ghostCard(aspect: number): CardBox {
  return { x: 0.5 - aspect / 2, y: 0, w: aspect, h: 1 };
}

/** Região do rodapé (frações da área, carta em pé), recortada aos limites da área. */
export function footerRegion(card: CardBox, geo: CardGeometry): Region | null {
  const f = geo.footer;
  const x0 = Math.max(0, card.x + f.x * card.w);
  const y0 = Math.max(0, card.y + f.y * card.h);
  const x1 = Math.min(1, card.x + (f.x + f.w) * card.w);
  const y1 = Math.min(1, card.y + (f.y + f.h) * card.h);
  if (x1 - x0 < f.w * card.w * 0.5 || y1 - y0 < f.h * card.h * 0.5) return null; // rodapé fora da área
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
