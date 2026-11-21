import type { NameEntry } from '../games/types';

/**
 * Corretor de nomes: recebe o texto (imperfeito) lido pelo OCR e encontra o nome
 * de carta mais parecido. Ex.: "Lightnlng Bo1t" -> "Lightning Bolt".
 *
 * Como funciona, em duas fases para ser rápido com ~35 mil nomes:
 * 1. Pré-filtro por "trigramas" (pedaços de 3 letras): pega os nomes que mais
 *    compartilham pedaços com o texto lido.
 * 2. Para esses poucos candidatos, calcula a distância de edição (quantas letras
 *    precisam mudar) e escolhe o mais parecido.
 */

export interface MatchResult {
  cardName: string;
  matchText: string;
  /** 0 a 1. Acima de ~0.75 costuma ser confiável. */
  score: number;
}

export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

export class FuzzyMatcher {
  private keys: string[] = [];
  private entries: NameEntry[] = [];
  private index = new Map<string, number[]>();
  private hits: Uint16Array;

  constructor(entries: NameEntry[]) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = normalize(entry.matchText);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const id = this.keys.length;
      this.keys.push(key);
      this.entries.push(entry);
      for (const g of trigrams(key)) {
        let list = this.index.get(g);
        if (!list) this.index.set(g, (list = []));
        list.push(id);
      }
    }
    this.hits = new Uint16Array(this.keys.length);
  }

  get size(): number {
    return this.keys.length;
  }

  match(rawText: string, candidatesToCheck = 40): MatchResult | null {
    const query = normalize(rawText);
    if (query.length < 3) return null;

    // Fase 1: contar trigramas em comum.
    const touched: number[] = [];
    for (const g of trigrams(query)) {
      const list = this.index.get(g);
      if (!list) continue;
      for (const id of list) {
        if (this.hits[id] === 0) touched.push(id);
        this.hits[id]++;
      }
    }
    touched.sort((a, b) => this.hits[b] - this.hits[a]);
    const candidates = touched.slice(0, candidatesToCheck);
    for (const id of touched) this.hits[id] = 0;

    // Fase 2: distância de edição. Também compara só o começo do texto lido,
    // porque o recorte às vezes pega lixo no fim (símbolos de mana).
    let best: MatchResult | null = null;
    for (const id of candidates) {
      const key = this.keys[id];
      const prefix = query.slice(0, key.length);
      const score = Math.max(similarity(query, key), similarity(prefix, key) - 0.05);
      if (!best || score > best.score) {
        best = { cardName: this.entries[id].cardName, matchText: this.entries[id].matchText, score };
      }
    }
    return best;
  }
}
