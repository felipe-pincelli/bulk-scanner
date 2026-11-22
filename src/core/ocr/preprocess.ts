import type { Rect } from '../camera/geometry';

/**
 * Prepara a faixa de busca para o OCR:
 * - recorta só a faixa (bem menos pixels que o quadro inteiro = mais rápido);
 * - gira para o texto ficar na horizontal (carta deitada ou de cabeça para baixo);
 * - redimensiona (o Tesseract gosta de letras com ~25–30 px de altura);
 * - converte para tons de cinza e estica o contraste.
 * Texto claro em fundo escuro é tratado pelo próprio Tesseract (ele tenta inverter).
 */
export const PAD = 10;

export function cropForOcr(
  source: HTMLVideoElement | HTMLCanvasElement,
  rect: Rect,
  out: HTMLCanvasElement,
  opts: { rotateDeg: 0 | 90 | 180 | 270; scale: number; invertIfDark?: boolean },
): HTMLCanvasElement {
  const { rotateDeg, scale, invertIfDark } = opts;
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
  // Texto claro em fundo escuro (ex.: rodapé da carta, branco na borda preta):
  // inverte para ficar texto escuro em fundo claro, que o Tesseract lê melhor.
  let sum = 0;
  for (let i = 0; i < px.length; i += 4) sum += px[i];
  const invert = invertIfDark && sum / total < lo + range * 0.45;
  for (let i = 0; i < px.length; i += 4) {
    let v = ((px[i] - lo) * 255) / range;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, PAD, PAD);
  return out;
}

/**
 * Procura, no recorte já preparado, a faixa horizontal que mais parece uma linha
 * de texto escuro sobre fundo claro (o nome da carta). Serve de "dica" para um
 * leitor especializado em uma linha só — que lê nomes curtos ("Moat", "Opt")
 * que os outros modos às vezes descartam como sujeira.
 *
 * Como: para cada linha de pixels, conta as bordas fortes (mudança brusca de
 * claro para escuro) em que o lado claro é bem claro. Soma isso numa janela da
 * altura das letras e pega a janela com mais pontos.
 */
export interface LineHint {
  left: number;
  top: number;
  width: number;
  height: number;
  /** true se encontrou a barra clara do nome (então left/width medem a barra). */
  barFound: boolean;
}

export function findTextRow(
  canvas: HTMLCanvasElement,
  textPx: number,
  /** Parte da largura a usar quando não há barra clara (frações), ex.: [0.28, 0.72]. */
  darkSpan?: [number, number],
  /** Escolher a linha de letras mais altas (em vez da com mais "cara de texto"). */
  tallest = false,
): LineHint | null {
  const { width: w, height: h } = canvas;
  if (h < textPx * 1.5) return null;
  const px = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const rowScore = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let score = 0;
    let prev = px[y * w * 4];
    for (let x = 1; x < w; x++) {
      const v = px[(y * w + x) * 4];
      const diff = v - prev;
      if ((diff > 60 || diff < -60) && Math.max(v, prev) > 170) score++;
      prev = v;
    }
    rowScore[y] = score;
  }
  const win = Math.max(4, Math.round(textPx));
  let sum = 0;
  for (let y = 0; y < win; y++) sum += rowScore[y];
  let best = sum;
  let bestY = 0;
  for (let y = win; y < h; y++) {
    sum += rowScore[y] - rowScore[y - win];
    if (sum > best) {
      best = sum;
      bestY = y - win + 1;
    }
  }
  if (best < win * 2) return null; // quase nenhuma borda: não há texto
  let tallestH = 0;
  if (tallest) {
    // Blocos de linhas seguidas com texto; o mais alto é o de letras maiores.
    const thr = Math.max(...rowScore) * 0.2;
    let bestH = 0;
    for (let y = 0; y < h; ) {
      if (rowScore[y] < thr) {
        y++;
        continue;
      }
      const start = y;
      let gap = 0;
      let end = y;
      for (; y < h && gap <= 2; y++) {
        if (rowScore[y] >= thr) {
          end = y;
          gap = 0;
        } else gap++;
      }
      const blockH = end - start + 1;
      if (blockH > bestH && blockH >= win * 0.5) {
        bestH = blockH;
        bestY = Math.round((start + end) / 2 - win / 2);
      }
    }
    tallestH = bestH;
  }
  // Faixa um pouco maior que as letras (pega acentos e partes de baixo).
  // (No modo "mais alto", a faixa acompanha a altura medida das letras, para não
  // pegar pedaços das linhas vizinhas.)
  const height = Math.min(h, Math.round(tallestH ? Math.max(tallestH * 1.5, win) : textPx * 2.2));
  const top = Math.max(0, Math.min(h - height, Math.round(bestY + win / 2 - height / 2)));

  // Na horizontal: fica só com o trecho CLARO da faixa (a barra do nome).
  // Bordas pretas da carta dos lados fazem o Tesseract achar que é texto branco
  // em fundo preto e ler lixo — principalmente em nomes curtos.
  const colBright = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    let bright = 0;
    for (let y = top; y < top + height; y++) if (px[(y * w + x) * 4] > 150) bright++;
    colBright[x] = bright > height * 0.5 ? 1 : 0;
  }
  // Maior sequência de colunas claras (tolerando buracos pequenos = letras grossas).
  const gapTolerance = Math.round(textPx * 1.5);
  let bestStart = 0;
  let bestLen = 0;
  for (let x = 0; x < w; ) {
    if (!colBright[x]) {
      x++;
      continue;
    }
    const start = x;
    let end = x;
    let gap = 0;
    for (; x < w && gap <= gapTolerance; x++) {
      if (colBright[x]) {
        end = x;
        gap = 0;
      } else gap++;
    }
    if (end - start + 1 > bestLen) {
      bestLen = end - start + 1;
      bestStart = start;
    }
  }
  if (bestLen < textPx * 4) {
    // Barra escura (texto claro): usa a parte da largura indicada pelo jogo, ou tudo.
    if (darkSpan) {
      const left = Math.round(PAD + darkSpan[0] * (w - 2 * PAD));
      const right = Math.round(PAD + darkSpan[1] * (w - 2 * PAD));
      return { left, top, width: right - left, height, barFound: false };
    }
    return { left: 0, top, width: w, height, barFound: false };
  }
  return { left: bestStart, top, width: bestLen, height, barFound: true };
}
