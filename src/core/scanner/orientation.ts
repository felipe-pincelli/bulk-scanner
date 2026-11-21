import type { Region } from '../games/types';

/**
 * Orientação da carta dentro da área de detecção (quadrada).
 * O número é para onde aponta o TOPO da carta, em graus no sentido horário:
 *   0 = em pé · 90 = deitada, topo à direita · 180 = de cabeça para baixo · 270 = deitada, topo à esquerda
 */
export type Orientation = 0 | 90 | 180 | 270;
export const ORIENTATIONS: Orientation[] = [0, 90, 180, 270];

export const orientationLabel: Record<Orientation, string> = {
  0: 'em pé',
  90: 'deitada (topo à direita)',
  180: 'de cabeça para baixo',
  270: 'deitada (topo à esquerda)',
};

/** Gira uma região (definida com a carta em pé) para a orientação pedida. */
export function rotateRegion(r: Region, o: Orientation): Region {
  switch (o) {
    case 0:
      return r;
    case 90: // topo da carta vira a borda direita
      return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
    case 180:
      return { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h };
    case 270: // topo da carta vira a borda esquerda
      return { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
  }
}

/** Quanto girar o recorte para o texto ficar na horizontal. */
export function correctionDeg(o: Orientation): Orientation {
  return ((360 - o) % 360) as Orientation;
}
