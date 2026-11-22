/**
 * Índice de Yu-Gi-Oh! TCG a partir do TCGCSV (cópia diária do TCGplayer).
 *
 * Cada código impresso ("LOB-EN001") vira UMA impressão com três preços:
 *   unlimited (campo usd) · 1ª edição (campo foil) · raridade especial (campo etched)
 * "Raridade especial" = versões com o mesmo código em raridade mais alta
 * (Starlight, Ghost, Quarter Century, Collector's…), que o TCGplayer lista como
 * produtos separados, com a raridade entre parênteses.
 *
 * Nomes em português: YGOPRODeck (https://ygoprodeck.com/api-guide/) — lista em
 * inglês e em português com o mesmo id da carta (2 consultas). Se falhar, segue sem.
 *
 * Para testar sem internet: --yugioh-fixture arquivo.json (formato do TCGCSV +
 * { ygopro: { en: [...], pt: [...] } } opcional).
 */
import { readFileSync } from 'node:fs';
import { IndexBuilder } from './lib/indexBuilder';
import { findCategoryId, getJson, priceValue, productNumber, tcgGroups, type Price } from './lib/tcgcsv';

/** Raridades "especiais" que aparecem entre parênteses no nome do produto. */
const SPECIAL =
  /starlight|ghost|quarter century|collector|platinum|prismatic|ultimate|secret|gold|10000|pharaoh|duel terminal|premium|holographic|parallel|alternate art|alt art|emblazoned|ultra rare|super rare|rare/i;

export function cleanYugiohName(name: string): string {
  return name
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\s*\(([^)]*)\)/g, (all: string, inner: string) => (SPECIAL.test(inner) || /^\s*[\d\s-]+\s*$/.test(inner) ? '' : all))
    .replace(/\s+-\s+[A-Z0-9]{2,5}-[A-Z]{0,2}\d{2,3}[a-z]?\s*$/, '') // " - LOB-EN001"
    .replace(/\s+/g, ' ')
    .trim();
}

export const isSpecialProduct = (name: string) =>
  [...name.matchAll(/\(([^)]*)\)/g)].some((m) => SPECIAL.test(m[1]));

/** Preços de um produto: unlimited (ou limited) e 1ª edição. */
function productPrices(prices: Price[]): { unl: number | null; first: number | null } {
  let unl: number | null = null;
  let first: number | null = null;
  for (const p of prices) {
    const v = priceValue(p);
    if (v == null) continue;
    if (/1st/i.test(p.subTypeName)) first = first === null ? v : Math.max(first, v);
    else unl = unl === null ? v : Math.min(unl, v); // Unlimited / Limited / Normal
  }
  return { unl, first };
}

/** Cartas de premiação (troféus) nunca aparecem em bulk e distorcem o máximo. */
const MAX_PRICE = 10000;

export async function buildYugioh(builder: IndexBuilder): Promise<string> {
  const fixtureArg = process.argv.indexOf('--yugioh-fixture');
  const fixture = fixtureArg > 0 ? JSON.parse(readFileSync(process.argv[fixtureArg + 1], 'utf8')) : null;
  const categoryId = fixture ? 0 : await findCategoryId(/yu-?gi-?oh/i);
  console.log(`[yugioh] categoria TCGCSV: ${categoryId}`);

  // Lista oficial de nomes (YGOPRODeck): usada para corrigir nomes de produto com
  // marcações que a limpeza não pegou, e para os nomes em português.
  const ygo = await fetchYgopro(fixture?.ygopro);
  const official = new Set(ygo?.en.map((c) => c.name) ?? []);
  // Mesma grafia ignorando símbolos/pontuação ("YummySnatchy" = "Yummy★Snatchy").
  const key = (n: string) => n.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const officialByKey = new Map([...official].map((n) => [key(n), n]));
  const canonical = (raw: string, cleaned: string): string => {
    if (!official.size || official.has(cleaned)) return cleaned;
    const same = officialByKey.get(key(cleaned));
    if (same) return same;
    // Corta do fim, em " (" / " - " / " [", até achar um nome oficial.
    let cut = raw;
    for (;;) {
      const i = Math.max(cut.lastIndexOf(' ('), cut.lastIndexOf(' - '), cut.lastIndexOf(' ['));
      if (i <= 0) break;
      cut = cut.slice(0, i).trim();
      if (official.has(cut)) return cut;
      const sameCut = officialByKey.get(key(cut));
      if (sameCut) return sameCut;
    }
    return cleaned;
  };
  const unmatched = new Set<string>();

  let groups = 0;
  let cards = 0;
  let skippedPrize = 0;
  for await (const { group: g, set, products, pricesByProduct } of tcgGroups(categoryId, fixture)) {
    groups++;
    const byNumber = new Map<string, { name: string; unl: number[]; first: number[]; special: number[] }>();
    for (const prod of products) {
      const number = productNumber(prod);
      if (!number) continue; // produtos selados
      const name = canonical(prod.name, cleanYugiohName(prod.name));
      if (!name) continue;
      if (official.size && !official.has(name)) unmatched.add(prod.name);
      const { unl, first } = productPrices(pricesByProduct.get(prod.productId) ?? []);
      if ((unl ?? 0) >= MAX_PRICE || (first ?? 0) >= MAX_PRICE) {
        skippedPrize++;
        continue;
      }
      let e = byNumber.get(number);
      if (!e) byNumber.set(number, (e = { name, unl: [], first: [], special: [] }));
      if (isSpecialProduct(prod.name)) {
        const v = Math.max(unl ?? 0, first ?? 0);
        if (v) e.special.push(v);
      } else {
        e.name = name;
        if (unl !== null) e.unl.push(unl);
        if (first !== null) e.first.push(first);
      }
      cards++;
    }
    for (const [number, e] of byNumber) {
      const all = [...e.unl, ...e.first, ...e.special];
      const usd = e.unl.length ? Math.min(...e.unl) : e.first.length ? Math.min(...e.first) : all.length ? Math.min(...all) : null;
      const first = e.first.length ? Math.max(...e.first) : null;
      const special = e.special.length ? Math.max(...e.special) : null;
      builder.addName(e.name);
      builder.addPrinting(e.name, set, g.name, number, usd, first, special);
    }
  }
  console.log(`[yugioh] coleções: ${groups} · produtos de cartas: ${cards} · premiação ignorada: ${skippedPrize}`);
  console.log(`[yugioh] produtos sem nome oficial correspondente: ${unmatched.size} · ${[...unmatched].slice(0, 25).join(' | ')}`);
  if (ygo) addPortugueseNames(builder, ygo);
  for (const name of ['Blue-Eyes White Dragon', 'Dark Magician', 'Ash Blossom & Joyous Spring', 'Pot of Greed']) {
    const r = builder.rows.get(name);
    if (r) console.log(`  ${name}: US$ ${r[1]} – ${r[3]} · ${builder.printings.get(name)?.length ?? 0} impressões · mais cara: ${r[5]} (${r[6]})`);
  }
  if (!fixture && cards < 10000) throw new Error(`só ${cards} produtos de cartas (esperado > 10000)`);
  return new Date().toISOString();
}

type YgoCard = { id: number; name: string };
type YgoLists = { en: YgoCard[]; pt: YgoCard[] };

/** Listas do YGOPRODeck em inglês e português (mesmo id). Null se indisponível. */
async function fetchYgopro(fixture?: YgoLists): Promise<YgoLists | null> {
  if (fixture) return fixture;
  try {
    const url = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';
    const en = (await getJson<{ data: YgoCard[] }>(url)).data;
    let pt: YgoCard[] = [];
    try {
      pt = (await getJson<{ data: YgoCard[] }>(`${url}?language=pt`)).data;
    } catch (e) {
      console.warn('[yugioh] sem nomes em português hoje:', (e as Error).message);
    }
    return { en, pt };
  } catch (e) {
    console.warn('[yugioh] YGOPRODeck indisponível hoje:', (e as Error).message);
    return null;
  }
}

/** Nomes em português pelo YGOPRODeck (mesmo id em inglês e português). */
function addPortugueseNames(builder: IndexBuilder, { en, pt }: YgoLists) {
  {
    const enById = new Map(en.map((c) => [c.id, c.name]));
    let added = 0;
    for (const c of pt) {
      const english = enById.get(c.id);
      if (!english || !c.name || c.name === english) continue;
      if (!builder.rows.has(english) || builder.rows.has(c.name)) continue;
      if (builder.aliases[c.name] === undefined) added++;
      builder.aliases[c.name] = english;
    }
    console.log(`[yugioh] nomes em português: ${added} (de ${pt.length} cartas no YGOPRODeck)`);
  }
}
