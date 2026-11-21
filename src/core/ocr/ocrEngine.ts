/**
 * Contrato do motor de OCR. Hoje: Tesseract.js. Se um dia trocarmos por algo
 * mais rápido, só uma nova implementação deste contrato é necessária.
 */
export interface OcrLine {
  text: string;
  /** 0 a 100, segundo o próprio motor. */
  confidence: number;
}

export interface OcrEngine {
  init(onProgress?: (msg: string) => void): Promise<void>;
  /** Lê todas as linhas de texto encontradas na imagem. */
  readLines(image: HTMLCanvasElement): Promise<OcrLine[]>;
  dispose(): Promise<void>;
}
