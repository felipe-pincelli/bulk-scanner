import type { Printing } from '../games/types';

/**
 * Interpreta o texto lido no rodapé, comparando SÓ com as impressões que existem
 * para aquela carta. Ex.: rodapé "117/384 R" + "2X2 • EN" e a carta Lightning
 * Bolt → impressão de Double Masters 2022, nº 117.
 *
 * Restringir às edições daquela carta torna a leitura confiável mesmo com o OCR
 * errando letras parecidas (O/0, I/1, S/5, B/8, Z/2).
 */
export interface EditionResult {
  /** Impressão exata (quando edição + número, ou a edição só tem uma versão). */
  printing: Printing | null;
  /** Edição reconhecida (código minúsculo), mesmo sem saber qual versão. */
  set: string | null;
  /** Impressões compatíveis com o que foi lido (todas da mesma edição). */
  candidates: Printing[];
}

/** Iguala letras/dígitos que o OCR costuma confundir. */
function fold(s: string): string {
  return s
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL|!]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6');
}

const stripZeros = (n: string) => n.replace(/^0+(?=\w)/, '').toLowerCase();

export function parseFooter(text: string, printings: Printing[]): EditionResult | null {
  if (!printings.length) return null;
  const tokens = text
    .split(/[\s•*·.,:;'"`~_()[\]{}<>-]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // --- Edição: tokens que batem com o código de alguma edição desta carta.
  const setsByFold = new Map<string, Set<string>>();
  for (const p of printings) {
    const f = fold(p.set);
    if (!setsByFold.has(f)) setsByFold.set(f, new Set());
    setsByFold.get(f)!.add(p.set);
  }
  const foundSets = new Set<string>();
  for (const raw of tokens) {
    // Códigos de edição são impressos em MAIÚSCULAS: ignora palavras com
    // minúsculas (nome do artista, "Illus.", etc.).
    if (raw !== raw.toUpperCase()) continue;
    const t = raw;
    // O OCR às vezes junta o idioma: "2X2EN".
    const variants = [t, t.endsWith('EN') && t.length >= 5 ? t.slice(0, -2) : ''];
    for (const v of variants) {
      if (v.length < 3 || v.length > 5) continue;
      const hit = setsByFold.get(fold(v));
      if (hit && hit.size === 1) foundSets.add([...hit][0]);
    }
  }

  // --- Número de colecionador: "117", "0117", "117/384", "117a".
  const numbers = new Set<string>();
  for (const raw of tokens) {
    const m = raw.match(/^([0-9OIlSBZ]{1,4}[a-z]?)(?:\/[0-9OIlSBZ]{1,4})?$/i);
    if (!m) continue;
    // Converte letras confundidas em dígitos só na parte numérica.
    const digits = m[1].replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    if (/^\d/.test(digits)) numbers.add(stripZeros(digits));
  }
  const numberMatches = (p: Printing) => numbers.has(stripZeros(p.number));

  let candidates: Printing[];
  let set: string | null = null;
  if (foundSets.size === 1) {
    set = [...foundSets][0];
    candidates = printings.filter((p) => p.set === set);
  } else if (foundSets.size > 1) {
    // Mais de uma edição "lida": usa o número para desempatar.
    candidates = printings.filter((p) => foundSets.has(p.set) && numberMatches(p));
    if (!candidates.length) return null;
    set = candidates.every((p) => p.set === candidates[0].set) ? candidates[0].set : null;
    if (!set) return null;
  } else {
    return null; // sem edição reconhecida (ex.: carta antiga, sem código no rodapé)
  }

  const exact = candidates.length === 1 ? candidates : candidates.filter(numberMatches);
  return { printing: exact.length === 1 ? exact[0] : null, set, candidates };
}
