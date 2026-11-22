/**
 * Acesso ao TCGCSV (https://tcgcsv.com): cópia diária dos dados e preços do
 * TCGplayer, organizada por categoria (jogo) e coleção.
 *
 * - /tcgplayer/categories                  → jogos (Pokémon = 3, One Piece …)
 * - /tcgplayer/{categoria}/groups          → coleções
 * - /tcgplayer/{categoria}/{grupo}/products → cartas (nome, "Number", raridade)
 * - /tcgplayer/{categoria}/{grupo}/prices   → preço de cada variante
 *
 * Uma consulta por vez, com uma pequena pausa entre elas.
 */
export interface Group {
  groupId: number;
  name: string;
  abbreviation?: string;
}
export interface Product {
  productId: number;
  name: string;
  extendedData?: { name: string; value: string }[];
}
export interface Price {
  productId: number;
  subTypeName: string;
  marketPrice: number | null;
  midPrice: number | null;
}

/** Dados de teste no lugar da internet: { groups, products: {id: []}, prices: {id: []} } */
export interface TcgFixture {
  groups: Group[];
  products: Record<string, Product[]>;
  prices: Record<string, Price[]>;
}

const BASE = 'https://tcgcsv.com/tcgplayer';
const HEADERS = { 'User-Agent': 'BulkScanner/0.3 (personal project)', Accept: 'application/json' };
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(url: string, tries = 3): Promise<T> {
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

/** Descobre o número da categoria pelo nome do jogo (ex.: /one piece/i). */
export async function findCategoryId(name: RegExp): Promise<number> {
  const { results } = await getJson<{ results: { categoryId: number; name: string; displayName?: string }[] }>(
    `${BASE}/categories`,
  );
  const cat = results.find((c) => name.test(c.displayName ?? '') || name.test(c.name));
  if (!cat) throw new Error(`categoria ${name} não encontrada no TCGCSV`);
  return cat.categoryId;
}

export interface TcgGroup {
  group: Group;
  /** Sigla única da coleção (minúscula). */
  set: string;
  products: Product[];
  pricesByProduct: Map<number, Price[]>;
}

/** Percorre as coleções de uma categoria, uma de cada vez. */
export async function* tcgGroups(categoryId: number, fixture?: TcgFixture | null): AsyncGenerator<TcgGroup> {
  const groups: Group[] = fixture
    ? fixture.groups
    : (await getJson<{ results: Group[] }>(`${BASE}/${categoryId}/groups`)).results;
  const abbrOwner = new Map<string, number>(); // sigla → coleção que a usou primeiro
  for (const group of groups) {
    const products: Product[] = fixture
      ? (fixture.products[group.groupId] ?? [])
      : (await getJson<{ results: Product[] }>(`${BASE}/${categoryId}/${group.groupId}/products`)).results;
    const prices: Price[] = fixture
      ? (fixture.prices[group.groupId] ?? [])
      : (await getJson<{ results: Price[] }>(`${BASE}/${categoryId}/${group.groupId}/prices`)).results;
    if (!fixture) await sleep(120);

    const pricesByProduct = new Map<number, Price[]>();
    for (const p of prices) {
      if (!pricesByProduct.has(p.productId)) pricesByProduct.set(p.productId, []);
      pricesByProduct.get(p.productId)!.push(p);
    }
    // Se outra coleção já usa a mesma sigla, acrescenta o id para não misturar.
    let set = (group.abbreviation || `g${group.groupId}`).toLowerCase();
    const owner = abbrOwner.get(set);
    if (owner === undefined) abbrOwner.set(set, group.groupId);
    else if (owner !== group.groupId) set = `${set}-${group.groupId}`;
    yield { group, set, products, pricesByProduct };
  }
}

export const productNumber = (p: Product) => p.extendedData?.find((e) => e.name === 'Number')?.value;
export const priceValue = (p: Price) => p.marketPrice ?? p.midPrice;

/**
 * Nome como aparece IMPRESSO na carta. O TCGplayer acrescenta coisas para
 * diferenciar versões: "Charizard ex - 125/197", "Pikachu (Full Art)",
 * "Nami (Parallel)", "Professor's Research [Professor Oak]". Removemos esses extras.
 */
export function cleanTcgName(name: string): string {
  return name
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+-\s+[A-Za-z]{0,6}\s?\d+[a-z]?(\/[A-Za-z]{0,4}\d+)?\s*$/, '')
    .replace(/\s+-\s+[A-Z]{1,4}\d{0,3}-\d{2,3}[a-z]?\s*$/, '') // " - OP01-016"
    .replace(/\s+/g, ' ')
    .trim();
}
