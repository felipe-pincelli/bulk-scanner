import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrEngine, OcrResult } from './ocrEngine';

/**
 * OCR com Tesseract.js rodando num "worker" (processo separado do navegador),
 * para a tela continuar fluida enquanto lê.
 * Os arquivos do motor ficam em public/tesseract (sem depender de CDN).
 */
export class TesseractEngine implements OcrEngine {
  private worker: Worker | null = null;
  private progress: ((msg: string) => void) | undefined;

  constructor(
    private assetsUrl: string,
    private whitelist: string,
  ) {}

  async init(onProgress?: (msg: string) => void) {
    this.progress = onProgress;
    this.worker = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${this.assetsUrl}worker.min.js`,
      corePath: this.assetsUrl,
      langPath: this.assetsUrl,
      logger: (m) => this.progress?.(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`),
    });
    await this.worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: this.whitelist,
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    // Depois de carregado, para de reportar progresso (senão dispara a cada leitura).
    this.progress = undefined;
  }

  async readLine(image: HTMLCanvasElement): Promise<OcrResult> {
    if (!this.worker) throw new Error('OCR não inicializado');
    const { data } = await this.worker.recognize(image);
    return { text: data.text.trim(), confidence: data.confidence };
  }

  async dispose() {
    await this.worker?.terminate();
    this.worker = null;
  }
}
