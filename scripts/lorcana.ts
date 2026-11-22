/**
 * Índice de Disney Lorcana a partir do TCGCSV (cópia diária do TCGplayer).
 *
 * Nome completo da carta = personagem + versão: "Mickey Mouse - Brave Little Tailor"
 * (é assim que o TCGplayer nomeia). Cada produto vira uma impressão (número/total,
 * ex.: "12/204"; as Enchanted têm número próprio, ex.: "205/204"), com dois
 * preços: normal (campo usd) e cold foil (campo foil).
 *
 * Para testar sem internet: --lorcana-fixture arquivo.json (formato do TCGCSV).
 */
import { readFileSync } from 'node:fs';
import { IndexBuilder } from './lib/indexBuilder';
import { cleanTcgName, findCategoryId, priceValue, productNumber, tcgGroups, type Price } from './lib/tcgcsv';

/** Normal e foil (Cold Foil / Foil / Holofoil…). */
function splitPrices(prices: Price[]): { usd: number | null; foil: number | null } {
  let usd: number | null = null;
  const foils: number[] = [];
  for (const p of prices) {
    const v = priceValue(p);
    if (v == null) continue;
    if (/normal/i.test(p.subTypeName)) usd = usd === null ? v : Math.min(usd, v);
    else foils.push(v);
  }
  // Carta que só existe em foil (ex.: Enchanted): o "normal" é o próprio foil.
  if (usd === null && foils.length) usd = Math.min(...foils);
  return { usd, foil: foils.length ? Math.max(...foils) : null };
}

const MAX_PRICE = 10000; // premiação/troféus: nunca aparecem em bulk

export async function buildLorcana(builder: IndexBuilder): Promise<string> {
  const fixtureArg = process.argv.indexOf('--lorcana-fixture');
  const fixture = fixtureArg > 0 ? JSON.parse(readFileSync(process.argv[fixtureArg + 1], 'utf8')) : null;
  const categoryId = fixture ? 0 : await findCategoryId(/lorcana/i);
  console.log(`[lorcana] categoria TCGCSV: ${categoryId}`);

  let groups = 0;
  let cards = 0;
  let skipped = 0;
  const samples = new Set<string>();
  for await (const { group: g, set, products, pricesByProduct } of tcgGroups(categoryId, fixture)) {
    groups++;
    for (const prod of products) {
      const number = productNumber(prod);
      if (!number) continue; // produtos selados
      const name = cleanTcgName(prod.name);
      if (!name) continue;
      if (/[([]/.test(prod.name) && samples.size < 12) samples.add(prod.name);
      const { usd, foil } = splitPrices(pricesByProduct.get(prod.productId) ?? []);
      if ((usd ?? 0) >= MAX_PRICE || (foil ?? 0) >= MAX_PRICE) {
        skipped++;
        continue;
      }
      builder.addName(name);
      builder.addPrinting(name, set, g.name, number, usd, foil, null);
      cards++;
    }
  }
  console.log(`[lorcana] coleções: ${groups} · cartas: ${cards} · premiação ignorada: ${skipped}`);
  console.log(`[lorcana] exemplos com marcação: ${[...samples].join(' | ')}`);
  for (const name of ['Mickey Mouse - Brave Little Tailor', 'Elsa - Spirit of Winter', 'Stitch - Rock Star', 'Be Prepared']) {
    const r = builder.rows.get(name);
    if (r) console.log(`  ${name}: US$ ${r[1]} – ${r[3]} · ${builder.printings.get(name)?.length ?? 0} impressões · mais cara: ${r[5]} (${r[6]})`);
  }
  if (!fixture && cards < 800) throw new Error(`só ${cards} cartas (esperado > 800)`);
  return new Date().toISOString();
}
