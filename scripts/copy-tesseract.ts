/**
 * Copia os arquivos do Tesseract (motor de OCR) de node_modules para public/tesseract,
 * para o app não depender de CDN externo (e, mais tarde, funcionar offline).
 * Roda automaticamente antes de `npm run dev` e `npm run build`.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = 'public/tesseract';
mkdirSync(out, { recursive: true });

const files: [string, string][] = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  // Variantes "LSTM" do motor (só a rede neural, menor e mais rápida).
  // O próprio Tesseract escolhe a melhor conforme o aparelho suporta SIMD.
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  // Modelo de inglês "best_int": bom equilíbrio entre precisão e velocidade (~3 MB).
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

for (const [from, to] of files) copyFileSync(from, join(out, to));
console.log(`Tesseract: ${files.length} arquivos copiados para ${out}`);
