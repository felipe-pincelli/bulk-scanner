import type { AlertLevel } from '../alerts/alertRules';
import type { SessionEntry } from './session';

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
  /** " (2X2) 117", " (2X2)" ou "" */
  setSuffix: string;
}

function setSuffix(e: SessionEntry): string {
  if (e.printing) return ` (${e.printing.set.toUpperCase()}) ${e.printing.number}`;
  if (e.set) return ` (${e.set.toUpperCase()})`;
  return '';
}

/** Junta cópias repetidas da mesma carta ("Moat" lido 2x -> 2 Moat). */
function group(entries: SessionEntry[], scope: ExportScope, bySet = false): Grouped[] {
  const levels = SCOPE_LEVELS[scope];
  const map = new Map<string, Grouped>();
  for (const e of entries) {
    if (!levels.includes(e.level)) continue;
    const suffix = bySet ? setSuffix(e) : '';
    const key = e.cardName + suffix;
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { name: e.cardName, count: 1, entry: e, setSuffix: suffix });
  }
  // Mais valiosas primeiro.
  return [...map.values()].sort((a, b) => (b.entry.price?.maxUsd ?? 0) - (a.entry.price?.maxUsd ?? 0));
}

export function countExport(entries: SessionEntry[], scope: ExportScope): number {
  return group(entries, scope).reduce((n, g) => n + g.count, 0);
}

export function toDecklistText(entries: SessionEntry[], scope: ExportScope, withSet = false): string {
  return group(entries, scope, withSet)
    .map((g) => `${g.count} ${g.name}${g.setSuffix}`)
    .join('\n');
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const decimal = (n: number) => n.toFixed(2).replace('.', ',');
const money = (usd: number | null | undefined, rate: number | null) =>
  usd != null && rate ? decimal(usd * rate) : '';

export function toCsv(entries: SessionEntry[], scope: ExportScope): string {
  const header = ['Quantidade', 'Nome', 'Edição', 'Número', 'Alerta', 'Mín. R$', 'Máx. R$', 'Mín. US$', 'Máx. US$', 'Edição mais cara'];
  const levelName: Record<AlertLevel, string> = { red: 'vermelho', yellow: 'amarelo', check: 'confira a edição', none: '' };
  const rows = group(entries, scope, true).map(({ name, count, entry: e }) => [
    count,
    name,
    e.printing?.setName ?? (e.set ? (e.price?.maxSetName ?? e.set.toUpperCase()) : ''),
    e.printing?.number ?? '',
    levelName[e.level],
    money(e.price?.minUsd, e.usdBrl),
    money(e.price?.maxUsd, e.usdBrl),
    e.price?.minUsd != null ? decimal(e.price.minUsd) : '',
    e.price?.maxUsd != null ? decimal(e.price.maxUsd) : '',
    e.price?.maxSetName ?? '',
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
}

export function exportContent(entries: SessionEntry[], scope: ExportScope, format: ExportFormat) {
  const date = new Date().toISOString().slice(0, 10);
  return format === 'csv'
    ? { text: toCsv(entries, scope), filename: `bulk-scanner-${date}.csv`, mime: 'text/csv', bom: true }
    : {
        text: toDecklistText(entries, scope, format === 'textWithSet'),
        filename: `bulk-scanner-${date}.txt`,
        mime: 'text/plain',
        bom: false,
      };
}
