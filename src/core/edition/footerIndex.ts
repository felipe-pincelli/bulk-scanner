import type { PriceInfo, Printing } from '../games/types';

/**
 * Catálogo reverso: edição + número de colecionador → carta.
 *
 * Serve para identificar uma carta SÓ PELO RODAPÉ, sem ler o nome — essencial
 * para cartas em japonês, chinês, coreano, russo e phyrexiano (o nome não é lido
 * pelo OCR, mas o rodapé das cartas de 2015 em diante é em letras latinas:
 * "NEO • JA", "ONE • PH" + número).
 */
export interface FooterHit {
  cardName: string;
  printing: Printing;
}

export interface FooterIndex {
  /** código da edição "dobrado" (fold) → número normalizado → carta */
  bySet: Map<string, Map<string, FooterHit>>;
}

/** Iguala letras/dígitos que o OCR costuma confundir (mesma regra do parseFooter). */
export function foldCode(s: string): string {
  return s
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL|!]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6');
}

const normNumber = (n: string) => n.split('/')[0].replace(/^0+(?=\w)/, '').toLowerCase();

export function buildFooterIndex(prices: Map<string, PriceInfo>): FooterIndex {
  const bySet = new Map<string, Map<string, FooterHit>>();
  for (const [cardName, info] of prices) {
    for (const p of info.printings ?? []) {
      if (!p.number) continue;
      const key = foldCode(p.set);
      let m = bySet.get(key);
      if (!m) bySet.set(key, (m = new Map()));
      const num = normNumber(p.number);
      // Duas cartas com a mesma edição+número (raro, ex.: cartas de duas faces
      // listadas separadamente): guarda a primeira.
      if (!m.has(num)) m.set(num, { cardName, printing: p });
    }
  }
  return { bySet };
}

/**
 * Procura a carta pelo texto lido no rodapé: precisa de um código de edição que
 * exista (palavra em MAIÚSCULAS, 3 a 5 caracteres) E de um número que exista
 * nessa edição. Os dois juntos tornam um falso positivo muito improvável.
 */
export function identifyByFooter(text: string, index: FooterIndex): FooterHit | null {
  const tokens = text.split(/[\s•*·.,:;'"`~_()[\]{}<>-]+/).filter(Boolean);
  const sets: Map<string, FooterHit>[] = [];
  for (const raw of tokens) {
    if (raw !== raw.toUpperCase() || raw.length < 3 || raw.length > 5) continue;
    const variants = [raw, raw.length >= 5 && /[A-Z]{2}$/.test(raw) ? raw.slice(0, -2) : ''];
    for (const v of variants) {
      const m = v && index.bySet.get(foldCode(v));
      if (m) sets.push(m);
    }
  }
  if (!sets.length) return null;
  const numbers: string[] = [];
  for (const raw of tokens) {
    const m = raw.match(/^([0-9OIlSBZ|]{1,4}[a-z★]?)(?:\/[0-9OIlSBZ|]{1,4})?$/i);
    if (!m) continue;
    const digits = m[1].replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    if (/^\d/.test(digits)) numbers.push(normNumber(digits));
  }
  const hits = new Map<string, FooterHit>();
  for (const m of sets) for (const n of numbers) {
    const hit = m.get(n);
    if (hit) hits.set(`${hit.printing.set}|${hit.printing.number}`, hit);
  }
  return hits.size === 1 ? [...hits.values()][0] : null; // ambíguo → não chuta
}
