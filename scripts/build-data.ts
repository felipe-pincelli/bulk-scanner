/**
 * Gera os dados que o app usa e grava em public/data/.
 * Roda no GitHub Actions a cada deploy e uma vez por dia.
 *
 * 1. Baixa o "Default Cards" do Scryfall (~80 MB compactado: todas as impressões de
 *    todas as cartas, com preços) e gera um ÍNDICE ENXUTO: uma linha por nome de carta com
 *    o menor e o maior preço entre as impressões (com e sem foil).
 * 2. Busca a cotação USD → BRL (fica de reserva caso o app não consiga buscar ao vivo).
 *
 * Regras do Scryfall (https://scryfall.com/docs/api/bulk-data): usar os arquivos
 * em massa em vez de muitas chamadas, enviar User-Agent e Accept, e não baixar
 * mais de uma vez por dia (os preços só mudam uma vez por dia).
 *
 * Para testar com um arquivo local: npm run data -- --file caminho/para/cards.json
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const HEADERS = {
  'User-Agent': 'BulkScanner/0.2 (personal project)',
  Accept: 'application/json',
};

/** Formato de cada linha do índice (arrays em vez de objetos = arquivo bem menor). */
export type IndexRow = [
  name: string,
  minUsd: number | null, // impressão mais barata (sem foil; se não houver, foil)
  maxNonfoilUsd: number | null, // impressão sem foil mais cara
  maxUsd: number | null, // impressão mais cara, incluindo foil/etched
  maxSet: string, // edição da impressão mais cara (código, ex.: "lea")
  maxSetName: string,
  maxFinish: 'nonfoil' | 'foil' | 'etched' | '',
];

interface ScryfallCard {
  name: string;
  flavor_name?: string;
  layout: string;
  games?: string[];
  oversized?: boolean;
  promo_types?: string[];
  set: string;
  set_name: string;
  prices?: { usd?: string | null; usd_foil?: string | null; usd_etched?: string | null };
}

// Tipos de "carta" que não são cartas de jogo de verdade.
const SKIP_LAYOUTS = new Set(['art_series', 'token', 'double_faced_token', 'emblem', 'vanguard', 'scheme', 'planar']);

/**
 * Lê um arquivo gigante de cartas aos pedaços, sem carregar tudo na memória:
 * devolve cada carta assim que ela termina de chegar. Aceita os dois formatos do
 * Scryfall: uma lista JSON ("[{...},{...}]") ou JSON Lines (uma carta por linha).
 */
async function* streamJsonArray(chunks: AsyncIterable<Uint8Array | string>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let depth = 0;
  let inString = false;
  let escape = false;
  let buf = '';
  let start = -1;
  let startDepth = 0;
  for await (const chunk of chunks) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    buf += text;
    let i = buf.length - text.length;
    for (; i < buf.length; i++) {
      const c = buf.charCodeAt(i);
      if (inString) {
        if (escape) escape = false;
        else if (c === 92 /* \ */) escape = true;
        else if (c === 34 /* " */) inString = false;
      } else if (c === 34) inString = true;
      else if (c === 123 /* { */) {
        // Carta = objeto no nível de cima (JSON Lines) ou dentro da lista.
        if (start < 0 && depth <= 1) {
          start = i;
          startDepth = depth;
        }
        depth++;
      } else if (c === 125 /* } */) {
        depth--;
        if (start >= 0 && depth === startDepth) {
          yield buf.slice(start, i + 1);
          start = -1;
        }
      } else if (c === 91 /* [ */) depth++;
      else if (c === 93 /* ] */) depth--;
    }
    // Descarta o que já foi processado, mantendo só o objeto incompleto.
    if (start >= 0) {
      buf = buf.slice(start);
      start = 0;
    } else buf = '';
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function openCards(): Promise<{ chunks: AsyncIterable<Uint8Array | string>; updatedAt: string }> {
  const fileArg = process.argv.indexOf('--file');
  if (fileArg > 0) {
    const path = process.argv[fileArg + 1];
    const stream = createReadStream(path);
    return { chunks: path.endsWith('.gz') ? stream.pipe(createGunzip()) : stream, updatedAt: new Date().toISOString() };
  }
  type BulkItem = { type: string; updated_at: string };
  const list = await getJson<{ data: BulkItem[] }>('https://api.scryfall.com/bulk-data');
  const meta = list.data.find((item) => item.type === 'default_cards');
  if (!meta) throw new Error(`"default_cards" não encontrado em /bulk-data (${list.data.map((i) => i.type).join(', ')})`);
  // O link do arquivo pode vir na lista ou só nos detalhes do item, e o nome do
  // campo já variou entre versões da API. Procura nos dois lugares.
  const findUrl = (obj: Record<string, unknown>) =>
    [obj.jsonl_download_uri, obj.download_uri, obj.download_url].find(
      (v): v is string => typeof v === 'string' && v.startsWith('http'),
    );
  let url = findUrl(meta as unknown as Record<string, unknown>);
  const detailUri = (meta as unknown as { uri?: string }).uri;
  if (!url && detailUri) {
    const detail = await getJson<Record<string, unknown>>(detailUri);
    url = findUrl(detail);
  }
  if (!url) throw new Error(`Link de download não encontrado: ${JSON.stringify(meta)}`);
  console.log(`Baixando ${url} …`);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Download falhou: HTTP ${res.status}`);
  const file = Buffer.from(await res.arrayBuffer());
  // Arquivo .gz (compactado)? Os dois primeiros bytes de um gzip são 1f 8b.
  const gzipped = file[0] === 0x1f && file[1] === 0x8b;
  console.log(`Baixado: ${Math.round(file.length / 1e6)} MB${gzipped ? ' (compactado)' : ''}`);
  const stream = Readable.from([file]);
  return { chunks: gzipped ? stream.pipe(createGunzip()) : stream, updatedAt: meta.updated_at };
}

async function fetchUsdBrl(): Promise<number | null> {
  try {
    const j = await getJson<{ rates: { BRL: number } }>('https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL');
    return j.rates.BRL;
  } catch (e) {
    console.warn('Cotação indisponível:', (e as Error).message);
    return null;
  }
}

const num = (v: string | null | undefined) => (v ? Number(v) : null);

async function main() {
  mkdirSync('public/data', { recursive: true });
  const { chunks, updatedAt } = await openCards();

  const rows = new Map<string, IndexRow>();
  const aliases: Record<string, string> = {};
  let total = 0;

  for await (const raw of streamJsonArray(chunks)) {
    const card = JSON.parse(raw) as ScryfallCard;
    total++;
    if (SKIP_LAYOUTS.has(card.layout) || card.oversized) continue;
    if (card.games && !card.games.includes('paper')) continue; // só Arena/MTGO
    // Cartas numeradas (ex.: "123/500"): tiragem minúscula, nunca aparecem em bulk
    // e distorcem o preço máximo (um Sol Ring numerado passa de US$ 3.000).
    if (card.promo_types?.includes('serialized')) continue;

    let row = rows.get(card.name);
    if (!row) rows.set(card.name, (row = [card.name, null, null, null, '', '', '']));
    // "Godzilla Series" e similares: nome impresso diferente do oficial.
    if (card.flavor_name && card.flavor_name !== card.name) aliases[card.flavor_name] = card.name;

    const usd = num(card.prices?.usd);
    const foil = num(card.prices?.usd_foil);
    const etched = num(card.prices?.usd_etched);

    if (usd !== null) {
      if (row[1] === null || usd < row[1]) row[1] = usd;
      if (row[2] === null || usd > row[2]) row[2] = usd;
    }
    for (const [price, finish] of [
      [usd, 'nonfoil'],
      [foil, 'foil'],
      [etched, 'etched'],
    ] as const) {
      if (price !== null && (row[3] === null || price > row[3])) {
        row[3] = price;
        row[4] = card.set;
        row[5] = card.set_name;
        row[6] = finish;
      }
    }
  }
  // Cartas que só existem em foil: o "mais barato" é o foil mais barato.
  for (const row of rows.values()) if (row[1] === null && row[3] !== null) row[1] = row[3];

  // Trava de segurança: nunca publicar um índice vazio/quebrado.
  const minNames = process.argv.includes('--file') ? 1 : 20000;
  if (rows.size < minNames) {
    throw new Error(`Índice com só ${rows.size} nomes (esperado > ${minNames}). Nada foi publicado.`);
  }

  const usdBrl = await fetchUsdBrl();
  const index = {
    version: 1,
    game: 'magic',
    source: 'Scryfall (preços TCGplayer em USD)',
    pricesUpdatedAt: updatedAt,
    builtAt: new Date().toISOString(),
    usdBrl,
    rows: [...rows.values()].sort((a, b) => a[0].localeCompare(b[0])),
    aliases,
  };
  const json = JSON.stringify(index);
  writeFileSync('public/data/magic-index.json', json);
  // Amostra para conferência rápida no log do GitHub Actions.
  for (const name of ['Lightning Bolt', 'Sol Ring', 'Moat', 'Llanowar Elves', 'Fire // Ice']) {
    const r = rows.get(name);
    if (r) console.log(`  ${name}: US$ ${r[1]} – ${r[3]} (sem foil até ${r[2]}) · mais cara: ${r[5]} ${r[6]}`);
  }
  const withPrice = index.rows.filter((r) => r[3] !== null).length;
  console.log(
    `Impressões lidas: ${total} · nomes: ${rows.size} (${withPrice} com preço) · apelidos: ${Object.keys(aliases).length}` +
      ` · arquivo: ${(json.length / 1e6).toFixed(1)} MB · USD→BRL: ${usdBrl ?? 'indisponível'}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
