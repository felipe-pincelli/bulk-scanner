/**
 * Índice de Pokémon TCG a partir do TCGCSV (https://tcgcsv.com), que publica todo
 * dia uma cópia dos dados e preços do TCGplayer, organizada por coleção.
 *
 * - /tcgplayer/3/groups            → coleções (categoria 3 = Pokémon)
 * - /tcgplayer/3/{grupo}/products  → cartas (nome, "Number" = "013/198", raridade)
 * - /tcgplayer/3/{grupo}/prices    → preço de cada variante (Normal, Holofoil,
 *                                    Reverse Holofoil, 1st Edition…)
 *
 * ~450 consultas por dia, uma por vez, com uma pequena pausa entre elas.
 * Para testar sem internet: --pokemon-fixture arquivo.json
 * ({ groups: [...], products: { [groupId]: [...] }, prices: { [groupId]: [...] } })
 */
import { readFileSync } from 'node:fs';
import { IndexBuilder } from './lib/indexBuilder';

const BASE = 'https://tcgcsv.com/tcgplayer/3';
const HEADERS = { 'User-Agent': 'BulkScanner/0.3 (personal project)', Accept: 'application/json' };

interface Group {
  groupId: number;
  name: string;
  abbreviation?: string;
}
interface Product {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}
interface Price {
  productId: number;
  subTypeName: string;
  marketPrice: number | null;
  midPrice: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${(e as Error).message}`);
      await sleep(1000 * i);
    }
  }
}

/**
 * Nome como aparece IMPRESSO na carta. O TCGplayer acrescenta coisas para
 * diferenciar versões: "Charizard ex - 125/197", "Pikachu (Full Art)",
 * "Professor's Research [Professor Oak]". Removemos esses extras.
 */
export function cleanPokemonName(name: string): string {
  return name
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+-\s+[A-Za-z]{0,6}\s?\d+[a-z]?(\/[A-Za-z]{0,4}\d+)?\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Separa preço "normal" e "especial" (holo/reverse/1st edition) de uma carta. */
function splitPrices(prices: Price[]): { usd: number | null; foil: number | null; etched: number | null } {
  const value = (p: Price) => p.marketPrice ?? p.midPrice;
  const by = new Map(prices.map((p) => [p.subTypeName, value(p)]));
  // Versão "comum" da carta: Normal; se a carta só existe holo, a Holofoil.
  const base = by.get('Normal') ?? by.get('Unlimited') ?? by.get('Holofoil') ?? by.get('Unlimited Holofoil') ?? null;
  const special = [...by.entries()]
    .filter(([k, v]) => v != null && v !== base && /Reverse|Holo/i.test(k) && !/1st Edition/i.test(k))
    .map(([, v]) => v as number);
  const firstEd = [...by.entries()].filter(([k, v]) => v != null && /1st Edition/i.test(k)).map(([, v]) => v as number);
  return {
    usd: base ?? null,
    foil: special.length ? Math.max(...special) : null, // reverse holo / holo (campo "foil" do índice)
    etched: firstEd.length ? Math.max(...firstEd) : null, // 1ª edição, cartas antigas (campo "etched")
  };
}

export async function buildPokemon(builder: IndexBuilder): Promise<string> {
  const fixtureArg = process.argv.indexOf('--pokemon-fixture');
  const fixture = fixtureArg > 0 ? JSON.parse(readFileSync(process.argv[fixtureArg + 1], 'utf8')) : null;

  const groups: Group[] = fixture ? fixture.groups : (await getJson<{ results: Group[] }>(`${BASE}/groups`)).results;
  console.log(`[pokemon] coleções: ${groups.length}`);
  let cards = 0;
  const abbrOwner = new Map<string, number>(); // sigla → coleção que a usou primeiro
  for (const g of groups) {
    const products: Product[] = fixture
      ? (fixture.products[g.groupId] ?? [])
      : (await getJson<{ results: Product[] }>(`${BASE}/${g.groupId}/products`)).results;
    const prices: Price[] = fixture
      ? (fixture.prices[g.groupId] ?? [])
      : (await getJson<{ results: Price[] }>(`${BASE}/${g.groupId}/prices`)).results;
    if (!fixture) await sleep(120);

    const pricesByProduct = new Map<number, Price[]>();
    for (const p of prices) {
      if (!pricesByProduct.has(p.productId)) pricesByProduct.set(p.productId, []);
      pricesByProduct.get(p.productId)!.push(p);
    }
    // Sigla da coleção (ex.: "svi"). Se outra coleção já usa a mesma sigla,
    // acrescenta o id para não misturar as duas.
    let set = (g.abbreviation || `g${g.groupId}`).toLowerCase();
    const owner = abbrOwner.get(set);
    if (owner === undefined) abbrOwner.set(set, g.groupId);
    else if (owner !== g.groupId) set = `${set}-${g.groupId}`;
    for (const prod of products) {
      // Só cartas (produtos selados — boosters, caixas — não têm número).
      const number = prod.extendedData?.find((e) => e.name === 'Number')?.value;
      if (!number) continue;
      const name = cleanPokemonName(prod.name);
      if (!name) continue;
      const { usd, foil, etched } = splitPrices(pricesByProduct.get(prod.productId) ?? []);
      builder.addName(name);
      builder.addPrinting(name, set, g.name, number, usd, foil, etched);
      cards++;
    }
  }
  console.log(`[pokemon] cartas lidas: ${cards}`);
  // Trava de segurança: nunca publicar um índice quebrado (hoje são ~28 mil cartas).
  if (!fixture && cards < 15000) throw new Error(`só ${cards} cartas lidas (esperado > 15000)`);
  return new Date().toISOString();
}
