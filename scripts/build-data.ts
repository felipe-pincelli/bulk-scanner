/**
 * Gera os dados que o app usa e grava em public/data/ — um índice por jogo.
 * Roda no GitHub Actions a cada deploy e uma vez por dia.
 *
 * - Magic: baixa o "All Cards" do Scryfall (todas as impressões, em todos os
 *   idiomas). Preços: das impressões em inglês. Nomes em português: viram
 *   "apelidos" que apontam para o nome em inglês (ex.: "Relâmpago" → "Lightning Bolt"). Regras do Scryfall (https://scryfall.com/docs/api/bulk-data):
 *   usar os arquivos em massa, enviar User-Agent e Accept, no máximo 1x por dia.
 * - Pokémon: TCGCSV (cópia diária dos dados do TCGplayer) — ver scripts/pokemon.ts.
 * - Cotação USD → BRL (reserva caso o app não consiga buscar ao vivo).
 *
 * Uso: npm run data                       (todos os jogos)
 *      npm run data -- --game pokemon     (só um jogo)
 * Teste local: --file cards.json(.gz) (Magic), --pokemon-fixture arquivo.json
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { IndexBuilder } from './lib/indexBuilder';
import { buildPokemon } from './pokemon';

const HEADERS = {
  'User-Agent': 'BulkScanner/0.2 (personal project)',
  Accept: 'application/json',
};

interface ScryfallCard {
  name: string;
  lang?: string;
  printed_name?: string;
  card_faces?: { printed_name?: string }[];
  flavor_name?: string;
  layout: string;
  games?: string[];
  oversized?: boolean;
  promo_types?: string[];
  set: string;
  set_name: string;
  collector_number?: string;
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
  // "all_cards": todas as impressões em todos os idiomas (precisamos dos nomes em
  // português). Continua sendo UM download por dia, como pede o Scryfall.
  const meta = list.data.find((item) => item.type === 'all_cards');
  if (!meta) throw new Error(`"all_cards" não encontrado em /bulk-data (${list.data.map((i) => i.type).join(', ')})`);
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
  if (!res.ok || !res.body) throw new Error(`Download falhou: HTTP ${res.status}`);
  // Arquivo grande: processa enquanto baixa (sem guardar tudo na memória).
  // ".gz" = compactado (o servidor não descompacta sozinho).
  const gzipped = url.endsWith('.gz') && !res.headers.get('content-encoding');
  const size = Number(res.headers.get('content-length') ?? 0);
  console.log(`Tamanho: ${size ? Math.round(size / 1e6) + ' MB' : '?'}${gzipped ? ' (compactado)' : ''}`);
  const stream = Readable.fromWeb(res.body as never);
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

async function buildMagic(builder: IndexBuilder): Promise<string> {
  const { chunks, updatedAt } = await openCards();
  const started = Date.now();
  let total = 0;
  // Nome em português → quantas impressões usam esse nome para cada carta em
  // inglês. (Às vezes cartas diferentes receberam o mesmo nome em português.)
  const ptNames = new Map<string, Map<string, number>>();
  // Impressões só em outro idioma (ex.: artes alternativas japonesas): entram se
  // não houver a mesma edição+número em inglês.
  const foreign = new Map<string, ScryfallCard>(); // "set|número" → impressão com preço
  const englishKeys = new Set<string>();
  for await (const raw of streamJsonArray(chunks)) {
    const card = JSON.parse(raw) as ScryfallCard;
    total++;
    if (SKIP_LAYOUTS.has(card.layout) || card.oversized) continue;
    if (card.games && !card.games.includes('paper')) continue; // só Arena/MTGO
    // Cartas numeradas (ex.: "123/500"): tiragem minúscula, nunca aparecem em bulk
    // e distorcem o preço máximo (um Sol Ring numerado passa de US$ 3.000).
    if (card.promo_types?.includes('serialized')) continue;

    if (card.lang && card.lang !== 'en') {
      if (card.lang === 'pt') {
        // Nome impresso em português (cartas de duas faces: o de cada face).
        const printed = [card.printed_name, ...(card.card_faces ?? []).map((f) => f.printed_name)];
        for (const n of printed) {
          if (!n || n === card.name || n.includes(' // ')) continue;
          if (!ptNames.has(n)) ptNames.set(n, new Map());
          const counts = ptNames.get(n)!;
          counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
        }
      }
      const p = card.prices;
      const key = `${card.set}|${card.collector_number}`;
      if ((p?.usd || p?.usd_foil || p?.usd_etched) && !foreign.has(key)) foreign.set(key, card);
      continue;
    }
    englishKeys.add(`${card.set}|${card.collector_number}`);

    builder.addName(card.name);
    // "Godzilla Series" e similares: nome impresso diferente do oficial.
    if (card.flavor_name && card.flavor_name !== card.name) builder.aliases[card.flavor_name] = card.name;
    builder.addPrinting(
      card.name,
      card.set,
      card.set_name,
      card.collector_number ?? '',
      num(card.prices?.usd),
      num(card.prices?.usd_foil),
      num(card.prices?.usd_etched),
    );
  }
  // Impressões que só existem em outro idioma (sem a mesma edição+número em inglês).
  let foreignAdded = 0;
  for (const [key, card] of foreign) {
    if (englishKeys.has(key)) continue;
    builder.addName(card.name);
    builder.addPrinting(card.name, card.set, card.set_name, card.collector_number ?? '', num(card.prices?.usd), num(card.prices?.usd_foil), num(card.prices?.usd_etched));
    foreignAdded++;
  }
  // Apelidos em português (sem sobrescrever nomes oficiais em inglês). Se o mesmo
  // nome em português foi usado para cartas diferentes, fica a carta que usa esse
  // nome em mais impressões.
  let ptCount = 0;
  let conflicts = 0;
  const conflictSamples: string[] = [];
  for (const [pt, counts] of ptNames) {
    if (builder.rows.has(pt)) continue;
    const ranked = [...counts.entries()].filter(([en]) => builder.rows.has(en)).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    if (ranked.length > 1) {
      conflicts++;
      if (conflictSamples.length < 5) conflictSamples.push(`${pt}: ${ranked.map(([en, n]) => `${en} (${n})`).join(', ')}`);
    }
    builder.aliases[pt] = ranked[0][0];
    ptCount++;
  }
  console.log(
    `[magic] impressões lidas: ${total} em ${Math.round((Date.now() - started) / 1000)} s · só em outro idioma: ${foreignAdded}` +
      ` · nomes em português: ${ptCount} (${conflicts} com mais de uma carta)`,
  );
  for (const c of conflictSamples) console.log(`  conflito → ${c}`);
  for (const pt of ['Relâmpago', 'Anel Solar', 'Fosso', 'Elfos de Llanowar', 'Contramágica']) {
    if (builder.aliases[pt]) console.log(`  ${pt} → ${builder.aliases[pt]}`);
  }
  // Amostra para conferência rápida no log do GitHub Actions.
  for (const name of ['Lightning Bolt', 'Sol Ring', 'Moat', 'Llanowar Elves', 'Fire // Ice']) {
    const r = builder.rows.get(name);
    if (r) console.log(`  ${name}: US$ ${r[1]} – ${r[3]} (sem foil até ${r[2]}) · mais cara: ${r[5]} ${r[6]}`);
  }
  return updatedAt;
}

async function main() {
  mkdirSync('public/data', { recursive: true });
  const gameArg = process.argv.indexOf('--game');
  const only = gameArg > 0 ? process.argv[gameArg + 1] : null;
  const testing = process.argv.includes('--file') || process.argv.includes('--pokemon-fixture');
  const usdBrl = await fetchUsdBrl();
  console.log(`USD→BRL: ${usdBrl ?? 'indisponível'}`);

  // Magic: se falhar, o deploy falha (e o site continua com a versão anterior).
  if (!only || only === 'magic') {
    if (!testing || process.argv.includes('--file')) {
      const b = new IndexBuilder();
      const pricesUpdatedAt = await buildMagic(b);
      b.write(
        'public/data/magic-index.json',
        { game: 'magic', source: 'Scryfall (preços TCGplayer em USD)', pricesUpdatedAt, usdBrl },
        testing ? 1 : 20000,
      );
    }
  }

  // Pokémon: se falhar, avisa mas não derruba o deploy do Magic.
  if (!only || only === 'pokemon') {
    if (!testing || process.argv.includes('--pokemon-fixture')) {
      try {
        const b = new IndexBuilder();
        const pricesUpdatedAt = await buildPokemon(b);
        for (const name of ['Pikachu', 'Charizard ex', 'Umbreon VMAX', 'Professor\'s Research']) {
          const r = b.rows.get(name);
          if (r) console.log(`  ${name}: US$ ${r[1]} – ${r[3]} · ${b.printings.get(name)?.length ?? 0} impressões · mais cara: ${r[5]}`);
        }
        b.write(
          'public/data/pokemon-index.json',
          { game: 'pokemon', source: 'TCGCSV / TCGplayer (preços em USD)', pricesUpdatedAt, usdBrl },
          // Pokémon tem poucos NOMES (~4.500) e muitas versões de cada; a trava de
          // cartas fica em scripts/pokemon.ts.
          testing ? 1 : 2500,
        );
      } catch (e) {
        if (only === 'pokemon') throw e;
        console.warn('[pokemon] ÍNDICE NÃO GERADO:', (e as Error).message);
        process.exitCode = 0;
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
