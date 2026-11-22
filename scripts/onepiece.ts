/**
 * Índice de One Piece Card Game a partir do TCGCSV (cópia diária do TCGplayer).
 *
 * No One Piece, as versões alternativas (Parallel/Alternate Art, Manga, SP…) têm
 * o MESMO código da carta comum ("OP11-041") e são produtos separados no
 * TCGplayer. Aqui elas viram UMA impressão com três preços:
 *   normal (campo usd) · parallel/alt art (campo foil) · especial (campo etched)
 * e o usuário marca qual é no resumo (ou por lote), como o foil no Magic.
 *
 * Para testar sem internet: --onepiece-fixture arquivo.json (mesmo formato do Pokémon).
 */
import { readFileSync } from 'node:fs';
import { IndexBuilder } from './lib/indexBuilder';
import { findCategoryId, priceValue, productNumber, tcgGroups, type Price } from './lib/tcgcsv';

type Variant = 'base' | 'parallel' | 'special';

/** Parênteses que são marcação do TCGplayer (versão/numeração), e não parte do nome. */
const NUMBERING = /^\s*(\d+|[A-Z]{1,4}\d{0,3}-\d{2,3}[a-z]?)\s*$/i; // "(060)", "(OP17-119)"
const PARALLEL = /parallel|alternate art|alt[ .-]?art/i;
const SPECIAL =
  /manga|\bsp\b|\btr\b|gold|special|super|full art|foil|promo|textured|serial|signature|pre-?release|winner|judge|treasure|wanted|reprint|box topper|jolly roger|stamp|anniversary|championship|celebration/i;
const isMark = (m: string) => NUMBERING.test(m) || PARALLEL.test(m) || SPECIAL.test(m);

/** Classifica o produto pela marcação que o TCGplayer põe no nome. */
export function variantOf(name: string): Variant {
  const marks = [...name.matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map((m) => m[1] ?? m[2]);
  if (marks.some((m) => PARALLEL.test(m))) return 'parallel';
  if (marks.some((m) => SPECIAL.test(m))) return 'special';
  return 'base';
}

/**
 * Nome impresso na carta. Tira só as marcações de versão do TCGplayer; parênteses
 * que fazem parte do nome ficam: "Mr.1 (Daz.Bonez)", "Mr.2.Bon.Kurei(Bentham)".
 */
export function cleanOnePieceName(name: string): string {
  return name
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\(([^)]*)\)/g, (all, inner: string) => (isMark(inner) ? '' : all))
    .replace(/\s+-\s+[A-Z]{1,4}\d{0,3}-\d{2,3}[a-z]?\s*$/, '') // " - OP01-016"
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cartas de premiação (troféus, US$ 10 mil+) nunca aparecem em bulk e distorcem o máximo. */
const MAX_PRICE = 10000;

/** Preço de um produto: versão normal; se só existir foil, a foil. */
function productPrice(prices: Price[]): number | null {
  const by = new Map(prices.map((p) => [p.subTypeName, priceValue(p)]));
  return by.get('Normal') ?? by.get('Foil') ?? [...by.values()].find((v) => v != null) ?? null;
}

export async function buildOnePiece(builder: IndexBuilder): Promise<string> {
  const fixtureArg = process.argv.indexOf('--onepiece-fixture');
  const fixture = fixtureArg > 0 ? JSON.parse(readFileSync(process.argv[fixtureArg + 1], 'utf8')) : null;
  const categoryId = fixture ? 0 : await findCategoryId(/one piece/i);
  console.log(`[onepiece] categoria TCGCSV: ${categoryId}`);

  let groups = 0;
  let cards = 0;
  const markSamples = new Set<string>();
  const keptParens = new Set<string>();
  let skippedPrize = 0;
  for await (const { group: g, set, products, pricesByProduct } of tcgGroups(categoryId, fixture)) {
    groups++;
    // Junta as versões de cada código ("OP11-041") numa impressão só.
    const byNumber = new Map<string, { name: string; base: number[]; parallel: number[]; special: number[] }>();
    for (const prod of products) {
      const number = productNumber(prod);
      if (!number) continue; // produtos selados (boosters, caixas)
      const name = cleanOnePieceName(prod.name);
      if (!name) continue;
      const variant = variantOf(prod.name);
      if (variant !== 'base' && markSamples.size < 15) markSamples.add(prod.name);
      const price = productPrice(pricesByProduct.get(prod.productId) ?? []);
      if (price !== null && price >= MAX_PRICE) {
        skippedPrize++;
        continue;
      }
      if (/\(/.test(name) && keptParens.size < 8) keptParens.add(name);
      let entry = byNumber.get(number);
      if (!entry) byNumber.set(number, (entry = { name, base: [], parallel: [], special: [] }));
      if (variant === 'base') entry.name = name;
      if (price !== null) entry[variant].push(price);
      cards++;
    }
    for (const [number, e] of byNumber) {
      const all = [...e.base, ...e.parallel, ...e.special];
      // Se não existe a versão comum (ex.: promo só em parallel), a "normal" é a mais barata.
      const usd = e.base.length ? Math.min(...e.base) : all.length ? Math.min(...all) : null;
      const parallel = e.parallel.length ? Math.max(...e.parallel) : null;
      const special = e.special.length ? Math.max(...e.special) : null;
      builder.addName(e.name);
      builder.addPrinting(e.name, set, g.name, number, usd, parallel, special);
    }
  }
  console.log(`[onepiece] coleções: ${groups} · produtos de cartas: ${cards}`);
  console.log(`[onepiece] exemplos de versões: ${[...markSamples].join(' | ')}`);
  console.log(`[onepiece] nomes com parênteses mantidos: ${[...keptParens].join(' | ')}`);
  console.log(`[onepiece] cartas de premiação ignoradas (≥ US$ ${MAX_PRICE}): ${skippedPrize}`);
  for (const name of ['Nami', 'Monkey.D.Luffy', 'Roronoa Zoro', 'Shanks', 'Yamato']) {
    const r = builder.rows.get(name);
    if (r) console.log(`  ${name}: US$ ${r[1]} – ${r[3]} · ${builder.printings.get(name)?.length ?? 0} impressões · mais cara: ${r[5]} (${r[6]})`);
  }
  if (!fixture && cards < 1500) throw new Error(`só ${cards} produtos de cartas (esperado > 1500)`);
  return new Date().toISOString();
}
