/**
 * Contrato do motor de OCR. Hoje: Tesseract.js. Se um dia trocarmos por algo
 * mais rápido, só uma nova implementação deste contrato é necessária.
 */
export interface OcrResult {
  text: string;
  /** 0 a 100, segundo o próprio motor. */
  confidence: number;
}

export interface OcrEngine {
  init(onProgress?: (msg: string) => void): Promise<void>;
  /** Lê UMA linha de texto da imagem. */
  readLine(image: HTMLCanvasElement): Promise<OcrResult>;
  dispose(): Promise<void>;
}
