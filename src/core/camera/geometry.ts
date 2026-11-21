import type { Region } from '../games/types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * O <video> é mostrado com `object-fit: cover` (preenche a área cortando as bordas).
 * Esta função converte um retângulo em pixels da TELA para pixels do VÍDEO original,
 * para recortarmos exatamente o que está dentro da moldura.
 */
export function screenRectToVideoRect(rect: Rect, video: HTMLVideoElement): Rect {
  const box = video.getBoundingClientRect();
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(box.width / vw, box.height / vh);
  const offX = (box.width - vw * scale) / 2;
  const offY = (box.height - vh * scale) / 2;
  return {
    x: (rect.x - box.left - offX) / scale,
    y: (rect.y - box.top - offY) / scale,
    w: rect.w / scale,
    h: rect.h / scale,
  };
}

/** Sub-região (em frações) de um retângulo. */
export function subRect(outer: Rect, r: Region): Rect {
  return { x: outer.x + r.x * outer.w, y: outer.y + r.y * outer.h, w: r.w * outer.w, h: r.h * outer.h };
}
