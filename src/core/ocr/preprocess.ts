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
  opts: {
    rotateDeg: 0 | 90 | 180 | 270;
    scale: number;
    invertIfDark?: boolean;
    /** Inverte sempre (texto claro → escuro), sem decidir pela média. */
    invert?: boolean;
    /**
     * Preto e branco LOCAL (cada ponto comparado com a vizinhança): para recortes
     * com fundos de tons diferentes (ex.: rodapé do Yu-Gi-Oh!, moldura cinza +
     * caixa branca), onde um limite único para a imagem toda apagaria o texto.
     * Valor = altura aproximada das letras, em px.
     */
    localBinarizePx?: number;
  },
): HTMLCanvasElement {
  const { rotateDeg, scale, invertIfDark, invert: forceInvert, localBinarizePx } = opts;
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
  const invert = forceInvert || (invertIfDark && sum / total < lo + range * 0.45);
  for (let i = 0; i < px.length; i += 4) {
    let v = ((px[i] - lo) * 255) / range;
    if (invert) v = 255 - v;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  if (localBinarizePx) localBinarize(px, w, h, localBinarizePx);
  ctx.putImageData(img, PAD, PAD);
  return out;
}

/**
 * Binarização adaptativa (estilo Bradley): um ponto vira preto se for bem mais
 * escuro que a média da vizinhança. Usa "imagem integral" para calcular as
 * médias rápido. Espera texto escuro em fundo claro (já invertido, se preciso).
 */
function localBinarize(px: Uint8ClampedArray, w: number, h: number, textPx: number) {
  const r = Math.max(4, Math.round(textPx)); // vizinhança ~2× a altura das letras
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += px[(y * w + x) * 4];
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * w + x] = px[(y * w + x) * 4] < mean * 0.82 ? 0 : 255;
    }
  }
  for (let i = 0; i < out.length; i++) px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = out[i];
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
  /**
   * Próxima linha de texto logo abaixo (só no modo "mais alto"): na Lorcana, a
   * versão do personagem ("Brave Little Tailor"), em pixels do recorte.
   */
  below?: { top: number; height: number };
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
  let below: { top: number; height: number } | undefined;
  if (tallest) {
    // Blocos de linhas seguidas com texto; o mais alto é o de letras maiores.
    // Limite baixo: nomes curtos ("ELSA", "Nami") têm poucas bordas por linha,
    // bem menos que uma linha cheia de texto de regras.
    const thr = Math.max(4, Math.max(...rowScore) * 0.12);
    let bestH = 0;
    const blocks: { start: number; end: number }[] = [];
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
      blocks.push({ start, end });
      if (blockH > bestH && blockH >= win * 0.5) {
        bestH = blockH;
        bestY = Math.round((start + end) / 2 - win / 2);
      }
    }
    tallestH = bestH;
    // Próxima linha abaixo do nome, se estiver perto (não mais longe que ~1,6×
    // a altura das letras do nome).
    // Entre os blocos logo abaixo, fica com o que tem mais "cara de texto" (mais
    // bordas), ignorando faixas finas (bordas de moldura, pedaços de ícone).
    const nameEnd = Math.round(bestY + win / 2 + bestH / 2);
    let next: { start: number; end: number } | undefined;
    let nextScore = 0;
    for (const b of blocks) {
      if (b.start <= nameEnd - 1 || b.start - nameEnd > bestH * 1.6 || b.end - b.start + 1 < bestH * 0.3) continue;
      let sc = 0;
      for (let y = b.start; y <= b.end; y++) sc += rowScore[y];
      if (sc > nextScore) {
        nextScore = sc;
        next = b;
      }
    }
    if (next) {
      const bh = next.end - next.start + 1;
      const top = Math.max(0, Math.round(next.start - bh * 0.35));
      below = { top, height: Math.min(h - top, Math.round(bh * 1.7)) };
    }
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
      return { left, top, width: right - left, height, barFound: false, below };
    }
    return { left: 0, top, width: w, height, barFound: false, below };
  }
  return { left: bestStart, top, width: bestLen, height, barFound: true, below };
}

/** Inverte as cores de um recorte (texto claro ↔ escuro), em um canvas de saída. */
export function invertCanvas(src: HTMLCanvasElement, out: HTMLCanvasElement): HTMLCanvasElement {
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = 255 - px[i + 1];
    px[i + 2] = 255 - px[i + 2];
  }
  ctx.putImageData(img, 0, 0);
  return out;
}
