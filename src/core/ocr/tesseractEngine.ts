import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrEngine, OcrLine } from './ocrEngine';

/**
 * OCR com Tesseract.js rodando em "workers" (processos separados do navegador),
 * para a tela continuar fluida enquanto lê.
 *
 * Usamos DOIS leitores em paralelo, cada um com um jeito diferente de separar as
 * linhas da imagem. Nos testes, cada modo sozinho falhava em casos diferentes
 * (por causa da arte logo abaixo do nome); juntos acertaram todos. Como rodam ao
 * mesmo tempo em núcleos diferentes do processador, o tempo quase não aumenta.
 *
 * Os arquivos do motor ficam em public/tesseract (sem depender de CDN).
 */
const MODES = [
  PSM.SINGLE_COLUMN, // "coluna única": rápido, ótimo quando há espaço vazio em volta
  PSM.SINGLE_BLOCK, //  "bloco": melhor quando o nome está colado na arte
];

export class TesseractEngine implements OcrEngine {
  private workers: Worker[] = [];
  private progress: ((msg: string) => void) | undefined;

  constructor(
    private assetsUrl: string,
    private whitelist: string,
  ) {}

  async init(onProgress?: (msg: string) => void) {
    this.progress = onProgress;
    this.workers = await Promise.all(
      MODES.map(async (mode) => {
        const worker = await createWorker('eng', OEM.LSTM_ONLY, {
          workerPath: `${this.assetsUrl}worker.min.js`,
          corePath: this.assetsUrl,
          langPath: this.assetsUrl,
          logger: (m) => this.progress?.(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`),
        });
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          tessedit_char_whitelist: this.whitelist,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        return worker;
      }),
    );
    // Depois de carregado, para de reportar progresso (senão dispara a cada leitura).
    this.progress = undefined;
  }

  async readLines(image: HTMLCanvasElement): Promise<OcrLine[]> {
    if (!this.workers.length) throw new Error('OCR não inicializado');
    const results = await Promise.all(this.workers.map((w) => w.recognize(image, {}, { text: true, blocks: true })));
    const lines: OcrLine[] = [];
    const seen = new Set<string>();
    for (const { data } of results) {
      const found: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) found.push({ text: line.text.trim(), confidence: line.confidence });
        }
      }
      if (!found.length) {
        for (const text of data.text.split('\n')) found.push({ text: text.trim(), confidence: data.confidence });
      }
      for (const line of found) {
        if (line.text && !seen.has(line.text)) {
          seen.add(line.text);
          lines.push(line);
        }
      }
    }
    return lines;
  }

  async dispose() {
    await Promise.all(this.workers.map((w) => w.terminate()));
    this.workers = [];
  }
}
