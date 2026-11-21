import type { AlertLevel } from '../alerts/alertRules';
import type { PriceInfo, Printing } from '../games/types';
import { kvGet, kvSet } from '../storage/kvStore';

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
}

export interface Session {
  startedAt: number;
  entries: SessionEntry[];
}

const KEY = 'session:current';

export function newSession(): Session {
  return { startedAt: Date.now(), entries: [] };
}

export async function loadSession(): Promise<Session> {
  try {
    return (await kvGet<Session>(KEY)) ?? newSession();
  } catch {
    return newSession();
  }
}

export async function saveSession(session: Session): Promise<void> {
  try {
    await kvSet(KEY, session);
  } catch {
    /* sem IndexedDB: a sessão vale só enquanto a página estiver aberta */
  }
}

export function addEntry(session: Session, entry: Omit<SessionEntry, 'id'>): Session {
  const id = `${entry.at}-${Math.random().toString(36).slice(2, 7)}`;
  return { ...session, entries: [...session.entries, { ...entry, id }] };
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
  /** Soma da versão MAIS BARATA de cada carta com alerta (valor garantido). */
  totalMinBrl: number;
  /** Soma da versão MAIS CARA (se todas fossem as edições mais caras). */
  totalMaxBrl: number;
  durationMin: number;
}

const brlOf = (usd: number | null | undefined, rate: number | null) => (usd != null && rate ? usd * rate : 0);

export function summarize(session: Session): SessionSummary {
  const alerts = session.entries
    .filter((e) => e.level === 'yellow' || e.level === 'red')
    .sort((a, b) => (b.valueBrl ?? 0) - (a.valueBrl ?? 0));
  const checks = session.entries
    .filter((e) => e.level === 'check')
    .sort((a, b) => (b.valueBrl ?? 0) - (a.valueBrl ?? 0));
  const last = session.entries.at(-1)?.at ?? session.startedAt;
  return {
    scanned: session.entries.length,
    alerts,
    checks,
    totalMinBrl: alerts.reduce((sum, e) => sum + brlOf(e.price?.minUsd, e.usdBrl), 0),
    totalMaxBrl: alerts.reduce((sum, e) => sum + brlOf(e.price?.maxUsd, e.usdBrl), 0),
    durationMin: Math.max(0, Math.round((last - session.startedAt) / 60000)),
  };
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBrl(usd: number | null | undefined, rate: number | null): string {
  return usd != null && rate ? brl.format(usd * rate) : '—';
}

/** Texto simples da sessão, para copiar e colar (WhatsApp, notas…). */
export function sessionToText(s: SessionSummary, startedAt: number): string {
  const range = (e: SessionEntry) =>
    e.price?.minUsd === e.price?.maxUsd
      ? formatBrl(e.price?.maxUsd, e.usdBrl)
      : `${formatBrl(e.price?.minUsd, e.usdBrl)} a ${formatBrl(e.price?.maxUsd, e.usdBrl)}`;
  const line = (e: SessionEntry) =>
    `• ${e.cardName}: ${range(e)}` +
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
