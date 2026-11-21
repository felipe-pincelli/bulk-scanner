import type { CardIndex, GameProvider } from '../games/types';
import { kvGet, kvSet } from '../storage/kvStore';

/**
 * Carrega o índice de cartas/preços de um jogo.
 * - Se já existe uma cópia no aparelho com menos de 12h, usa ela (instantâneo, offline).
 * - Senão, baixa do site (o GitHub regenera o arquivo todo dia) e guarda no aparelho.
 * - Se o download falhar (sem internet), usa a cópia antiga, se houver.
 */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

interface Cached {
  fetchedAt: number;
  json: unknown;
}

export interface LoadedIndex {
  index: CardIndex;
  fetchedAt: number;
  fromCache: boolean;
  /** Preenchido se tentou atualizar e não conseguiu (mas há cópia antiga). */
  warning?: string;
}

export async function loadCardIndex(game: GameProvider, baseUrl: string, force = false): Promise<LoadedIndex> {
  const key = `index:${game.id}`;
  let cached: Cached | undefined;
  try {
    cached = await kvGet<Cached>(key);
  } catch {
    /* IndexedDB indisponível (ex.: aba anônima): segue sem cache */
  }

  if (cached && !force && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
    return { index: game.parseIndex(cached.json), fetchedAt: cached.fetchedAt, fromCache: true };
  }

  try {
    const res = await fetch(`${baseUrl}${game.indexFile}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const index = game.parseIndex(json); // valida antes de salvar
    const fetchedAt = Date.now();
    try {
      await kvSet(key, { fetchedAt, json } satisfies Cached);
    } catch {
      /* sem espaço/sem IndexedDB: funciona, só não fica salvo */
    }
    return { index, fetchedAt, fromCache: false };
  } catch (e) {
    if (cached) {
      return {
        index: game.parseIndex(cached.json),
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        warning: `Não consegui atualizar (${(e as Error).message}); usando a cópia salva.`,
      };
    }
    throw new Error(`Não consegui baixar os preços (${(e as Error).message}).`);
  }
}
