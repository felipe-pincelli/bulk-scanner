/**
 * Baixa do Scryfall os dados que o app usa e grava em public/data/.
 * Roda no GitHub Actions a cada deploy (e uma vez por dia).
 *
 * Etapa 1: só a lista de nomes de cartas (para corrigir erros do OCR).
 * Etapa 2: aqui também será gerado o índice enxuto de preços.
 *
 * Regras do Scryfall (https://scryfall.com/docs/api): enviar User-Agent e Accept,
 * no máximo ~10 requisições/segundo, e guardar os dados em cache por pelo menos 24h.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const HEADERS = {
  'User-Agent': 'BulkScanner/0.1 (personal project)',
  Accept: 'application/json',
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  mkdirSync('public/data', { recursive: true });

  const catalog = await getJson<{ data: string[] }>('https://api.scryfall.com/catalog/card-names');
  writeFileSync(
    'public/data/magic-names.json',
    JSON.stringify({ updatedAt: new Date().toISOString(), names: catalog.data }),
  );
  console.log(`Nomes de cartas: ${catalog.data.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
