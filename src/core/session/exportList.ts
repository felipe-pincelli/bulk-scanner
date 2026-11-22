import type { AlertLevel } from '../alerts/alertRules';
import type { GameProvider } from '../games/types';
import type { SessionEntry } from './session';
import { effectiveLevel, entryRangeUsd } from './finish';

/**
 * Exporta as cartas da sessão para outros sites/apps.
 *
 * Lista de texto ("2 Moat"): formato universal aceito pelos importadores do
 * Moxfield, Archidekt, MTGGoldfish, TappedOut, Deckstats, ManaBox, Scryfall etc.
 *
 * Lista com edição ("1 Lightning Bolt (2X2) 117"): formato do Moxfield, também
 * aceito pelo Archidekt e ManaBox. Usa a edição/número lidos no rodapé; cartas
 * sem edição identificada saem só com o nome.
 *
 * CSV: para planilhas (Excel, Google Sheets, Numbers), com preços. No padrão
 * brasileiro: separador ";" e vírgula decimal — senão o Excel em português abre
 * tudo numa coluna só. Começa com BOM para os acentos aparecerem certos.
 */
export type ExportScope = 'alerts' | 'alertsAndChecks' | 'all';
export type ExportFormat = 'text' | 'textWithSet' | 'csv';

const SCOPE_LEVELS: Record<ExportScope, AlertLevel[]> = {
  alerts: ['yellow', 'red'],
  alertsAndChecks: ['yellow', 'red', 'check'],
  all: ['yellow', 'red', 'check', 'none'],
};

interface Grouped {
  name: string;
  count: number;
  entry: SessionEntry; // uma das leituras (para preço/edição)
  /** Chave de edição usada para agrupar ("2x2|117", "2x2|" ou "") */
  setSuffix: string;
}

function setSuffix(e: SessionEntry): string {
  const f = e.finish && e.finish !== 'nonfoil' ? `|${e.finish}` : '';
  if (e.printing) return `${e.printing.set}|${e.printing.number}${f}`;
  if (e.set) return `${e.set}|${f}`;
  return f;
}

/** Junta cópias repetidas da mesma carta ("Moat" lido 2x -> 2 Moat). */
function group(entries: SessionEntry[], scope: ExportScope, bySet = false, minBrl = 0): Grouped[] {
  const levels = SCOPE_LEVELS[scope];
  const map = new Map<string, Grouped>();
  for (const e of entries) {
    if (!levels.includes(effectiveLevel(e, minBrl))) continue;
    const suffix = bySet ? setSuffix(e) : '';
    const key = e.cardName + suffix;
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { name: e.cardName, count: 1, entry: e, setSuffix: suffix });
  }
  // Mais valiosas primeiro.
  return [...map.values()].sort((a, b) => (entryRangeUsd(b.entry).max ?? 0) - (entryRangeUsd(a.entry).max ?? 0));
}

export function countExport(entries: SessionEntry[], scope: ExportScope, minBrl = 0): number {
  return group(entries, scope, false, minBrl).reduce((n, g) => n + g.count, 0);
}

export function toDecklistText(
  entries: SessionEntry[],
  scope: ExportScope,
  game: GameProvider,
  withSet = false,
  minBrl = 0,
): string {
  return group(entries, scope, withSet, minBrl)
    .map((g) => {
      const e = g.entry;
      const set = e.printing?.set ?? e.set;
      return withSet && set
        ? game.exportWithSet.line(g.count, g.name, set, e.printing?.number ?? null, e.finish)
        : `${g.count} ${g.name}`;
    })
    .join('\n');
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const decimal = (n: number) => n.toFixed(2).replace('.', ',');
const money = (usd: number | null | undefined, rate: number | null) =>
  usd != null && rate ? decimal(usd * rate) : '';

export function toCsv(entries: SessionEntry[], scope: ExportScope, minBrl = 0): string {
  const header = ['Quantidade', 'Nome', 'Edição', 'Número', 'Acabamento', 'Alerta', 'Mín. R$', 'Máx. R$', 'Mín. US$', 'Máx. US$', 'Edição mais cara'];
  const finishName = { nonfoil: 'normal', foil: 'foil', etched: 'especial' } as const;
  const levelName: Record<AlertLevel, string> = { red: 'vermelho', yellow: 'amarelo', check: 'confira a edição', none: '' };
  const rows = group(entries, scope, true, minBrl).map(({ name, count, entry: e }) => {
    const r = entryRangeUsd(e);
    return [
    count,
    name,
    e.printing?.setName ?? (e.set ? (e.price?.maxSetName ?? e.set.toUpperCase()) : ''),
    e.printing?.number ?? '',
    e.finish ? finishName[e.finish] : '',
    levelName[effectiveLevel(e, minBrl)],
    money(r.min, e.usdBrl),
    money(r.max, e.usdBrl),
    r.min != null ? decimal(r.min) : '',
    r.max != null ? decimal(r.max) : '',
    e.price?.maxSetName ?? '',
  ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}

export function exportContent(
  entries: SessionEntry[],
  scope: ExportScope,
  format: ExportFormat,
  game: GameProvider,
  minBrl = 0,
) {
  const date = new Date().toISOString().slice(0, 10);
  return format === 'csv'
    ? { text: toCsv(entries, scope, minBrl), filename: `bulk-scanner-${game.id}-${date}.csv`, mime: 'text/csv', bom: true }
    : {
        text: toDecklistText(entries, scope, game, format === 'textWithSet', minBrl),
        filename: `bulk-scanner-${game.id}-${date}.txt`,
        mime: 'text/plain',
        bom: false,
      };
}
