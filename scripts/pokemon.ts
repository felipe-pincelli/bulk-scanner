/**
 * Índice de Pokémon TCG a partir do TCGCSV (cópia diária do TCGplayer) —
 * categoria 3. Ver scripts/lib/tcgcsv.ts.
 *
 * ~450 consultas por dia, uma por vez, com uma pequena pausa entre elas.
 * Para testar sem internet: --pokemon-fixture arquivo.json
 * ({ groups, products: { [groupId]: [...] }, prices: { [groupId]: [...] }, tcgdex? })
 */
import { readFileSync } from 'node:fs';
import { IndexBuilder } from './lib/indexBuilder';
import { cleanTcgName, getJson, priceValue, productNumber, tcgGroups, type Price } from './lib/tcgcsv';

/** Mantido para compatibilidade: mesmo que cleanTcgName. */
export const cleanPokemonName = cleanTcgName;

/** Separa preço "normal" e "especial" (holo/reverse/1st edition) de uma carta. */
function splitPrices(prices: Price[]): { usd: number | null; foil: number | null; etched: number | null } {
  const by = new Map(prices.map((p) => [p.subTypeName, priceValue(p)]));
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

  let cards = 0;
  let groups = 0;
  for await (const { group: g, set, products, pricesByProduct } of tcgGroups(3, fixture)) {
    groups++;
    for (const prod of products) {
      // Só cartas (produtos selados — boosters, caixas — não têm número).
      const number = productNumber(prod);
      if (!number) continue;
      const name = cleanTcgName(prod.name);
      if (!name) continue;
      const { usd, foil, etched } = splitPrices(pricesByProduct.get(prod.productId) ?? []);
      builder.addName(name);
      builder.addPrinting(name, set, g.name, number, usd, foil, etched);
      cards++;
    }
  }
  console.log(`[pokemon] coleções: ${groups}`);
  console.log(`[pokemon] cartas lidas: ${cards}`);
  await addPortugueseNames(builder, fixture?.tcgdex);
  // Trava de segurança: nunca publicar um índice quebrado (hoje são ~28 mil cartas).
  if (!fixture && cards < 15000) throw new Error(`só ${cards} cartas lidas (esperado > 15000)`);
  return new Date().toISOString();
}

/**
 * Nomes em português (Treinadores e Energias; os nomes dos Pokémon são iguais).
 * TCGdex (https://tcgdex.dev) tem as cartas em vários idiomas com o MESMO id
 * ("swsh3-136") — 2 consultas: lista em inglês e lista em português.
 * Se falhar, segue sem os nomes em português (não derruba o índice).
 */
async function addPortugueseNames(builder: IndexBuilder, fixture?: { en: Brief[]; pt: Brief[] }) {
  try {
    const en: Brief[] = fixture?.en ?? (await getJson<Brief[]>('https://api.tcgdex.net/v2/en/cards'));
    let pt: Brief[] | null = fixture?.pt ?? null;
    for (const lang of ['pt-br', 'pt']) {
      if (pt) break;
      try {
        const list = await getJson<Brief[]>(`https://api.tcgdex.net/v2/${lang}/cards`);
        if (Array.isArray(list) && list.length) pt = list;
      } catch {
        /* tenta o próximo código de idioma */
      }
    }
    if (!pt) throw new Error('lista em português indisponível');
    const enById = new Map(en.map((c) => [c.id, c.name]));
    let added = 0;
    for (const c of pt) {
      const english = enById.get(c.id);
      if (!english || !c.name || c.name === english) continue;
      const target = cleanPokemonName(english);
      if (!builder.rows.has(target) || builder.rows.has(c.name)) continue;
      if (builder.aliases[c.name] === undefined) added++;
      builder.aliases[c.name] = target;
    }
    console.log(`[pokemon] nomes em português: ${added} (de ${pt.length} cartas no TCGdex)`);
  } catch (e) {
    console.warn('[pokemon] sem nomes em português hoje:', (e as Error).message);
  }
}
type Brief = { id: string; name: string };
