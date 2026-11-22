import type { AlertLevel } from '../alerts/alertRules';
import type { PriceInfo, Printing } from '../games/types';
import { kvGet, kvSet } from '../storage/kvStore';
import { effectiveLevel, entryRangeUsd, type Condition, type Finish } from './finish';

/**
 * Sessão de escaneamento: todas as cartas reconhecidas, com o preço do momento.
 * Fica salva no aparelho (IndexedDB) a cada carta, para não perder nada se o
 * navegador recarregar a página no meio da sessão.
 */
export interface SessionEntry {
  id: string;
  cardName: string;
  at: number;
  level: AlertLevel;
  /** Valor (R$) que motivou o alerta. */
  valueBrl: number | null;
  /** Retrato do preço no momento da leitura (USD) e da cotação. */
  price: PriceInfo | null;
  usdBrl: number | null;
  /** Impressão exata identificada pelo rodapé (se houver). */
  printing?: Printing | null;
  /** Código da edição identificada (mesmo sem a versão exata). */
  set?: string | null;
  /** Acabamento informado pelo usuário (lote ou resumo). Sem valor = não informado. */
  finish?: Finish;
  /** Condição informada pelo usuário (lote ou resumo). Sem valor = não informada. */
  condition?: Condition;
  /** Nome como foi lido na carta, se diferente do oficial (ex.: "Relâmpago"). */
  printedName?: string;
  /** Idioma informado no lote (ex.: "japonês"), se não for o padrão. */
  lang?: string;
}

export interface Session {
  startedAt: number;
  entries: SessionEntry[];
}

/** Uma sessão por jogo. (Magic mantém a chave antiga, de antes de existir o seletor.) */
const keyFor = (gameId: string) => (gameId === 'magic' ? 'session:current' : `session:${gameId}`);

export function newSession(): Session {
  return { startedAt: Date.now(), entries: [] };
}

export async function loadSession(gameId: string): Promise<Session> {
  try {
    return (await kvGet<Session>(keyFor(gameId))) ?? newSession();
  } catch {
    return newSession();
  }
}

export async function saveSession(gameId: string, session: Session): Promise<void> {
  try {
    await kvSet(keyFor(gameId), session);
  } catch {
    /* sem IndexedDB: a sessão vale só enquanto a página estiver aberta */
  }
}

export function addEntry(session: Session, entry: Omit<SessionEntry, 'id'>): Session {
  const id = `${entry.at}-${Math.random().toString(36).slice(2, 7)}`;
  return { ...session, entries: [...session.entries, { ...entry, id }] };
}

/** Substitui a última leitura desta carta (quando a edição foi lida depois do alerta). */
export function replaceLastEntry(session: Session, entry: Omit<SessionEntry, 'id' | 'at'>): Session {
  const entries = [...session.entries];
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].cardName === entry.cardName) {
      entries[i] = { ...entries[i], ...entry };
      return { ...session, entries };
    }
  }
  return session;
}

export function setEntryFinish(session: Session, id: string, finish: Finish): Session {
  return { ...session, entries: session.entries.map((e) => (e.id === id ? { ...e, finish } : e)) };
}

export function setEntryCondition(session: Session, id: string, condition: Condition): Session {
  return { ...session, entries: session.entries.map((e) => (e.id === id ? { ...e, condition } : e)) };
}

export function removeEntry(session: Session, id: string): Session {
  return { ...session, entries: session.entries.filter((e) => e.id !== id) };
}

export interface SessionSummary {
  scanned: number;
  /** Cartas com alerta amarelo/vermelho, da mais valiosa para a menos. */
  alerts: SessionEntry[];
  /** Cartas com aviso "confira a edição". */
  checks: SessionEntry[];
  /** Demais cartas lidas (sem alerta) — dá para marcar foil nelas também. */
  others: SessionEntry[];
  /** Soma da versão MAIS BARATA de cada carta com alerta (valor garantido). */
  totalMinBrl: number;
  /** Soma da versão MAIS CARA (se todas fossem as edições mais caras). */
  totalMaxBrl: number;
  durationMin: number;
}

const brlOf = (usd: number | null | undefined, rate: number | null) => (usd != null && rate ? usd * rate : 0);
const valueOf = (e: SessionEntry) => brlOf(entryRangeUsd(e).max, e.usdBrl);

/** Resumo da sessão. `minBrl` recalcula o alerta das cartas em que o usuário marcou o acabamento. */
export function summarize(session: Session, minBrl = 0): SessionSummary {
  const level = (e: SessionEntry) => effectiveLevel(e, minBrl);
  const byValue = (a: SessionEntry, b: SessionEntry) => valueOf(b) - valueOf(a);
  const alerts = session.entries.filter((e) => level(e) === 'yellow' || level(e) === 'red').sort(byValue);
  const checks = session.entries.filter((e) => level(e) === 'check').sort(byValue);
  const others = session.entries.filter((e) => level(e) === 'none').sort(byValue);
  const last = session.entries.at(-1)?.at ?? session.startedAt;
  return {
    scanned: session.entries.length,
    alerts,
    checks,
    others,
    totalMinBrl: alerts.reduce((sum, e) => sum + brlOf(entryRangeUsd(e).min, e.usdBrl), 0),
    totalMaxBrl: alerts.reduce((sum, e) => sum + brlOf(entryRangeUsd(e).max, e.usdBrl), 0),
    durationMin: Math.max(0, Math.round((last - session.startedAt) / 60000)),
  };
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBrl(usd: number | null | undefined, rate: number | null): string {
  return usd != null && rate ? brl.format(usd * rate) : '—';
}

/** Texto simples da sessão, para copiar e colar (WhatsApp, notas…). */
export function sessionToText(s: SessionSummary, startedAt: number): string {
  const range = (e: SessionEntry) => {
    const r = entryRangeUsd(e);
    return r.min === r.max ? formatBrl(r.max, e.usdBrl) : `${formatBrl(r.min, e.usdBrl)} a ${formatBrl(r.max, e.usdBrl)}`;
  };
  const line = (e: SessionEntry) =>
    `• ${e.cardName}${e.printedName ? ` (${e.printedName})` : ''}${e.lang ? ` [${e.lang}]` : ''}: ${range(e)}` +
    (e.finish && e.finish !== 'nonfoil' ? (e.finish === 'foil' ? ' [foil]' : ' [especial]') : '') +
    (e.condition && e.condition !== 'NM' ? ` [${e.condition}]` : '') +
    (e.printing
      ? ` (${e.printing.setName} #${e.printing.number})`
      : e.set
        ? ` (${e.price?.maxSetName || e.set.toUpperCase()})`
        : e.price?.maxSetName
          ? ` (mais cara: ${e.price.maxSetName})`
          : '');
  const parts = [
    `Bulk Scanner — sessão de ${new Date(startedAt).toLocaleString('pt-BR')}`,
    `${s.scanned} cartas lidas · ${s.alerts.length} com alerta`,
    '',
    ...s.alerts.map(line),
  ];
  if (s.alerts.length) {
    parts.push('', `Total estimado: ${brl.format(s.totalMinBrl)} (versões mais baratas) a ${brl.format(s.totalMaxBrl)} (mais caras)`);
  }
  if (s.checks.length) parts.push('', 'Confira a edição:', ...s.checks.map(line));
  return parts.join('\n');
}
