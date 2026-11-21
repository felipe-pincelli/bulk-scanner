import type { Rect } from '../camera/geometry';

/**
 * Prepara o recorte do nome para o OCR:
 * - recorta só a faixa do nome (muito menos pixels = muito mais rápido);
 * - redimensiona para uma altura fixa (o Tesseract gosta de letras com ~30 px);
 * - converte para tons de cinza e estica o contraste;
 * - se o fundo for escuro (alguns frames têm texto branco), inverte as cores,
 *   porque o Tesseract lê melhor texto escuro em fundo claro.
 */
const TARGET_HEIGHT = 56;
const PAD = 12;

export function cropForOcr(source: HTMLVideoElement, rect: Rect, out: HTMLCanvasElement): HTMLCanvasElement {
  const scale = TARGET_HEIGHT / rect.h;
  const w = Math.max(1, Math.round(rect.w * scale));
  const h = TARGET_HEIGHT;
  out.width = w + PAD * 2;
  out.height = h + PAD * 2;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, PAD, PAD, w, h);

  const img = ctx.getImageData(PAD, PAD, w, h);
  const px = img.data;
  const gray = new Uint8ClampedArray(w * h);
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gray[j] = v;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / gray.length;
  const range = Math.max(1, max - min);
  // A maior parte do recorte é fundo: se a média é escura, o fundo é escuro.
  const invert = mean < min + range / 2;

  for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
    let v = ((gray[j] - min) * 255) / range;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.putImageData(img, PAD, PAD);
  return out;
}
