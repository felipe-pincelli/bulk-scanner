/**
 * Cotação do dólar em reais.
 * Ordem de tentativa: cópia salva (< 12h) → Frankfurter (dados do Banco Central
 * Europeu, grátis, sem cadastro) → ExchangeRate-API (grátis) → cópia salva antiga
 * → cotação que veio junto com o índice de preços.
 */
const KEY = 'usdBrl';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface Rate {
  usdBrl: number;
  at: number;
  source: string;
}

function readCache(): Rate | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Rate) : null;
  } catch {
    return null;
  }
}

function writeCache(rate: Rate) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rate));
  } catch {
    /* ignora */
  }
}

async function fetchWithTimeout(url: string, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const SOURCES: { name: string; get: () => Promise<number> }[] = [
  {
    name: 'Frankfurter',
    get: async () => (await fetchWithTimeout('https://api.frankfurter.dev/v1/latest?base=USD&symbols=BRL')).rates.BRL,
  },
  {
    name: 'ExchangeRate-API',
    get: async () => (await fetchWithTimeout('https://open.er-api.com/v6/latest/USD')).rates.BRL,
  },
];

export async function getUsdBrl(fallback: { usdBrl: number | null; at: string } | null, force = false): Promise<Rate | null> {
  const cached = readCache();
  if (cached && !force && Date.now() - cached.at < MAX_AGE_MS) return cached;

  for (const source of SOURCES) {
    try {
      const value = Number(await source.get());
      if (value > 0) {
        const rate = { usdBrl: value, at: Date.now(), source: source.name };
        writeCache(rate);
        return rate;
      }
    } catch {
      /* tenta a próxima */
    }
  }
  if (cached) return cached;
  if (fallback?.usdBrl) return { usdBrl: fallback.usdBrl, at: Date.parse(fallback.at), source: 'índice de preços' };
  return null;
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Formata um preço em dólar como reais (ou dólar, se não houver cotação). */
export function formatPrice(valueUsd: number | null, rate: Rate | null): string {
  if (valueUsd === null) return '—';
  return rate ? brl.format(valueUsd * rate.usdBrl) : usd.format(valueUsd);
}
