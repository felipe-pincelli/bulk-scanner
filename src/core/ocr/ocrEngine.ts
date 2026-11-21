import type { LineHint } from './preprocess';

/**
 * Contrato do motor de OCR. Hoje: Tesseract.js. Se um dia trocarmos por algo
 * mais rápido, só uma nova implementação deste contrato é necessária.
 */
export interface OcrLine {
  text: string;
  /** 0 a 100, segundo o próprio motor. */
  confidence: number;
  /** true se veio da leitura "uma linha" na faixa da dica (mais confiável para nomes curtos). */
  fromHint?: boolean;
}

export interface OcrEngine {
  init(onProgress?: (msg: string) => void): Promise<void>;
  /**
   * Lê todas as linhas de texto encontradas na imagem.
   * `lineHint`: faixa onde provavelmente está o nome (lida também como linha única).
   */
  readLines(image: HTMLCanvasElement, lineHint?: LineHint | null): Promise<OcrLine[]>;
  dispose(): Promise<void>;
}
