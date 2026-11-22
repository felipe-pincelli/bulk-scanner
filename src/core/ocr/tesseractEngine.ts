import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrEngine, OcrLine } from './ocrEngine';
import type { LineHint } from './preprocess';

/**
 * OCR com Tesseract.js rodando em "workers" (processos separados do navegador),
 * para a tela continuar fluida enquanto lê.
 *
 * Usamos TRÊS leitores em paralelo para o nome (e um quarto, separado, para o
 * rodapé com a edição):
 * - dois leem a faixa inteira, cada um com um jeito diferente de separar as
 *   linhas (cada modo sozinho falhava em casos diferentes, por causa da arte);
 * - um lê só a linha que o app acha que é o nome ("dica"), no modo "uma linha" —
 *   é ele que pega nomes curtos como "Moat" ou "Opt", que os outros descartam.
 * Como rodam ao mesmo tempo em núcleos diferentes do processador, o tempo quase
 * não aumenta.
 *
 * Os arquivos do motor ficam em public/tesseract (sem depender de CDN).
 */
const MODES = [
  PSM.SINGLE_COLUMN, // "coluna única": rápido, ótimo quando há espaço vazio em volta
  PSM.SINGLE_BLOCK, //  "bloco": melhor quando o nome está colado na arte
  PSM.SINGLE_LINE, //   "uma linha": só a faixa da dica (nomes curtos)
];
const LINE_WORKER = 2;

export class TesseractEngine implements OcrEngine {
  private workers: Worker[] = [];
  /** Leitor separado para o rodapé (letras pequenas, números e códigos). */
  private footerWorker: Worker | null = null;
  private progress: ((msg: string) => void) | undefined;

  constructor(
    private assetsUrl: string,
    private whitelist: string,
  ) {}

  private create(): Promise<Worker> {
    return createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${this.assetsUrl}worker.min.js`,
      corePath: this.assetsUrl,
      langPath: this.assetsUrl,
      // Carrega o worker pelo endereço normal (e não como "blob"), para o
      // service worker conseguir entregá-lo do cache quando estiver offline.
      workerBlobURL: false,
      logger: (m) => this.progress?.(`${m.status} ${Math.round((m.progress ?? 0) * 100)}%`),
    });
  }

  async init(onProgress?: (msg: string) => void) {
    this.progress = onProgress;
    const footer = this.create().then(async (w) => {
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/•*.- ',
        user_defined_dpi: '300',
      });
      return w;
    });
    this.workers = await Promise.all(
      MODES.map(async (mode) => {
        const worker = await this.create();
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          tessedit_char_whitelist: this.whitelist,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        return worker;
      }),
    );
    this.footerWorker = await footer;
    // Depois de carregado, para de reportar progresso (senão dispara a cada leitura).
    this.progress = undefined;
  }

  async readLines(image: HTMLCanvasElement, lineHint?: LineHint | null): Promise<OcrLine[]> {
    if (!this.workers.length) throw new Error('OCR não inicializado');
    const jobs = this.workers.map((w, i) => {
      if (i !== LINE_WORKER) return w.recognize(image, {}, { text: true, blocks: true });
      if (!lineHint) return null;
      const rectangle = { left: lineHint.left, top: lineHint.top, width: lineHint.width, height: lineHint.height };
      return w.recognize(image, { rectangle }, { text: true, blocks: true });
    });
    const results = await Promise.all(jobs);
    const lines: OcrLine[] = [];
    const seen = new Set<string>();
    // A leitura da dica vem primeiro: em caso de texto repetido, fica marcada como dela.
    const order = [LINE_WORKER, ...results.keys()].filter((i, pos, arr) => arr.indexOf(i) === pos);
    for (const i of order) {
      const result = results[i];
      if (!result) continue;
      const { data } = result;
      const fromHint = i === LINE_WORKER;
      const found: OcrLine[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) found.push({ text: line.text.trim(), confidence: line.confidence, fromHint });
        }
      }
      if (!found.length) {
        for (const text of data.text.split('\n')) found.push({ text: text.trim(), confidence: data.confidence, fromHint });
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

  /** Troca os caracteres aceitos no nome (cada jogo tem os seus). */
  async setNameWhitelist(whitelist: string) {
    this.whitelist = whitelist;
    await Promise.all(this.workers.map((w) => w.setParameters({ tessedit_char_whitelist: whitelist })));
  }

  async readSingleLine(image: HTMLCanvasElement): Promise<OcrLine | null> {
    const w = this.workers[LINE_WORKER];
    if (!w) return null;
    const { data } = await w.recognize(image);
    const text = data.text.trim();
    return text ? { text, confidence: data.confidence, fromHint: true } : null;
  }

  async readFooter(image: HTMLCanvasElement): Promise<string> {
    if (!this.footerWorker) return '';
    const { data } = await this.footerWorker.recognize(image);
    return data.text;
  }

  async dispose() {
    await Promise.all([...this.workers, this.footerWorker].map((w) => w?.terminate()));
    this.workers = [];
    this.footerWorker = null;
  }
}
