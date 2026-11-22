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

  // --- Número de colecionador: "117", "0117", "117a", e "063/198" (Pokémon:
  // número + total da coleção — combinado com o nome, quase sempre é único).
  const digitize = (t: string) =>
    t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
  const numbers = new Set<string>(); // só o número ("117")
  const fullNumbers = new Set<string>(); // número/total ("63/198")
  for (const raw of tokens) {
    const m = raw.match(/^([0-9OIlSBZ|]{1,4}[a-z]?)(?:\/([0-9OIlSBZ|]{1,4}))?$/i);
    if (!m) continue;
    const n = digitize(m[1]);
    if (!/^\d/.test(n)) continue;
    numbers.add(stripZeros(n));
    if (m[2]) fullNumbers.add(`${stripZeros(n)}/${stripZeros(digitize(m[2]))}`);
  }
  const fullOf = (p: Printing) => {
    const [a, b] = p.number.split('/');
    return b ? `${stripZeros(a)}/${stripZeros(b)}` : null;
  };
  // Se a impressão tem total ("063/198"), exige número E total; senão, só o número.
  const numberMatches = (p: Printing) => {
    const full = fullOf(p);
    return full ? fullNumbers.has(full) : numbers.has(stripZeros(p.number));
  };

  // --- Código com hífen (One Piece "OP11-041", Yu-Gi-Oh! "LOB-EN001"): já inclui a
  // coleção e identifica a carta sozinho. Aceita espaços em volta do hífen, letras
  // trocadas pelo OCR ("0P11-04I") e ignora o idioma do código ("LOB-PT001" =
  // "LOB-EN001": mesma carta, impressa em português).
  const codeKey = (prefix: string, rest: string) => `${fold(prefix)}-${fold(rest.replace(/^[A-Za-z]{1,2}(?=[0-9OIlSBZ|]{2,3}$)/, ''))}`;
  const codes = new Set<string>();
  for (const m of text.matchAll(/([A-Za-z0-9|]{1,5})\s?-\s?([A-Za-z]{0,2}[0-9OIlSBZ|]{2,3})/g)) codes.add(codeKey(m[1], m[2]));
  const printedKey = (n: string) => {
    const i = n.indexOf('-');
    return codeKey(n.slice(0, i), n.slice(i + 1));
  };
  if (codes.size && printings.some((p) => p.number.includes('-'))) {
    const byCode = printings.filter((p) => p.number.includes('-') && codes.has(printedKey(p.number)));
    if (byCode.length && byCode.every((p) => p.set === byCode[0].set)) {
      return { printing: byCode.length === 1 ? byCode[0] : null, set: byCode[0].set, candidates: byCode };
    }
  }

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
    // Sem código de edição: aceita só "número/total" que aponte para UMA edição.
    candidates = printings.filter((p) => fullOf(p) !== null && numberMatches(p));
    if (!candidates.length || !candidates.every((p) => p.set === candidates[0].set)) return null;
    set = candidates[0].set;
  }

  const exact = candidates.length === 1 ? candidates : candidates.filter(numberMatches);
  return { printing: exact.length === 1 ? exact[0] : null, set, candidates };
}
