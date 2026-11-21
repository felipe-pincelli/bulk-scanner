import type { Rect } from '../camera/geometry';

/**
 * Prepara a faixa de busca para o OCR:
 * - recorta só a faixa (bem menos pixels que o quadro inteiro = mais rápido);
 * - gira para o texto ficar na horizontal (carta deitada ou de cabeça para baixo);
 * - redimensiona (o Tesseract gosta de letras com ~25–30 px de altura);
 * - converte para tons de cinza e estica o contraste.
 * Texto claro em fundo escuro é tratado pelo próprio Tesseract (ele tenta inverter).
 */
const PAD = 10;

export function cropForOcr(
  source: HTMLVideoElement | HTMLCanvasElement,
  rect: Rect,
  out: HTMLCanvasElement,
  opts: { rotateDeg: 0 | 90 | 180 | 270; scale: number },
): HTMLCanvasElement {
  const { rotateDeg, scale } = opts;
  const sw = Math.max(1, Math.round(rect.w * scale));
  const sh = Math.max(1, Math.round(rect.h * scale));
  const sideways = rotateDeg === 90 || rotateDeg === 270;
  const w = sideways ? sh : sw;
  const h = sideways ? sw : sh;
  out.width = w + PAD * 2;
  out.height = h + PAD * 2;

  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.save();
  ctx.translate(PAD + w / 2, PAD + h / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();

  const img = ctx.getImageData(PAD, PAD, w, h);
  const px = img.data;
  // Contraste: usa os percentis 2% e 98% (ignora reflexos e pontos pretos isolados).
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const v = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    px[i] = v;
    hist[v | 0]++;
  }
  const total = w * h;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.02; hi--);
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = ((px[i] - lo) * 255) / range;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, PAD, PAD);
  return out;
}
