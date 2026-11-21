import type { Region } from '../games/types';
import { PAD, type LineHint } from '../ocr/preprocess';

/**
 * Onde fica o rodapé da carta (número de colecionador + código da edição).
 *
 * A gente não "vê" a carta inteira; mas o app já acha a BARRA DO NOME. Como as
 * proporções de uma carta de Magic são fixas, a largura e a posição da barra dizem
 * o tamanho e a posição da carta — e daí, onde fica o rodapé.
 *
 * Tudo aqui é em frações da área de detecção quadrada, com a carta EM PÉ (antes de
 * aplicar a orientação).
 */

// Proporções do frame moderno (2015+), em frações da carta.
const BAR_LEFT = 0.045; // a barra do nome começa a 4,5% da largura
const BAR_WIDTH = 0.91; // e ocupa 91% da largura
const NAME_CENTER_Y = 0.0725; // centro do texto do nome, em fração da altura
const CARD_ASPECT = 63 / 88;
/** Rodapé: canto inferior esquerdo (número/raridade e edição/idioma/artista). */
const FOOTER: Region = { x: 0.03, y: 0.895, w: 0.62, h: 0.09 };
/** Altura das letras do rodapé, em fração da altura da carta. */
export const FOOTER_TEXT_H = 0.012;

export interface CardBox {
  /** Retângulo da carta em frações da área de detecção (carta em pé). */
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
export function estimateCard(hint: LineHint | null, band: Region, scalePx: number): CardBox | null {
  if (!hint?.barFound) return null;
  const barLeft = band.x + (hint.left - PAD) / scalePx;
  const barWidth = hint.width / scalePx;
  const textCenter = band.y + (hint.top + hint.height / 2 - PAD) / scalePx;
  const w = barWidth / BAR_WIDTH;
  const h = w / CARD_ASPECT;
  // Sanidade: a carta tem que ter um tamanho plausível dentro da área.
  if (w < 0.25 || w > 1.05) return null;
  return { x: barLeft - BAR_LEFT * w, y: textCenter - NAME_CENTER_Y * h, w, h };
}

/** Região do rodapé (frações da área, carta em pé), recortada aos limites da área. */
export function footerRegion(card: CardBox): Region | null {
  const x0 = Math.max(0, card.x + FOOTER.x * card.w);
  const y0 = Math.max(0, card.y + FOOTER.y * card.h);
  const x1 = Math.min(1, card.x + (FOOTER.x + FOOTER.w) * card.w);
  const y1 = Math.min(1, card.y + (FOOTER.y + FOOTER.h) * card.h);
  if (x1 - x0 < FOOTER.w * card.w * 0.5 || y1 - y0 < FOOTER.h * card.h * 0.5) return null; // rodapé fora da área
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
