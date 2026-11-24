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
 * Liga (LigaMagic, LigaPokémon, LigaYuGiOh, LigaOnePiece):
 * - coleção: CSV no modelo "Padrão LigaMagic CSV" (colunas Edição (PTBR), Edição
 *   (EN), Edição (Sigla), Card (PT), Card (EN), Quantidade, Qualidade, Idioma,
 *   Raridade, Cor, Extras, Card #, Comentário). Obrigatórias: sigla, nome em
 *   inglês e quantidade.
 * - lista de texto (deck/lista de compras): "1 Lightning Bolt [M10]".
 *
 * CSV: para planilhas (Excel, Google Sheets, Numbers), com preços. No padrão
 * brasileiro: separador ";" e vírgula decimal — senão o Excel em português abre
 * tudo numa coluna só. Começa com BOM para os acentos aparecerem certos.
 */
export type ExportScope = 'alerts' | 'alertsAndChecks' | 'all';
export type ExportFormat = 'text' | 'textWithSet' | 'csv' | 'ligaCsv' | 'ligaText';

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
  const f =
    (e.finish && e.finish !== 'nonfoil' ? `|${e.finish}` : '') +
    (e.condition ? `|${e.condition}` : '') +
    `|${ligaLanguage(e)}`; // não soma a mesma carta em idiomas diferentes
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
  const header = ['Quantidade', 'Nome', 'Edição', 'Número', 'Acabamento', 'Condição', 'Idioma', 'Alerta', 'Mín. R$', 'Máx. R$', 'Mín. US$', 'Máx. US$', 'Edição mais cara'];
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
    e.condition ?? '',
    e.lang ?? '',
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

/** Idioma no código que a Liga usa ("" = não informado, como no arquivo da Liga). */
function ligaLanguage(e: SessionEntry): string {
  const byLot: Record<string, string> = { japonês: 'JP', coreano: 'KO', russo: 'RU', chinês: 'TW' };
  if (e.lang && byLot[e.lang]) return byLot[e.lang];
  // Lida pelo nome em português (ex.: "Relâmpago") → carta em português.
  if (e.printedName && /[a-záàâãéêíóôõúç]/i.test(e.printedName) && !/[\u3000-\u9fff]/.test(e.printedName)) return 'BR';
  return '';
}

const LIGA_QUALITY: Record<string, string> = { NM: 'NM', SP: 'SP', MP: 'MP', HP: 'HP', DMG: 'D' };

/** Aspas só onde precisa (espaço, vírgula, aspas), como no arquivo da Liga. */
const ligaCell = (v: string | number) => {
  const s = String(v);
  return /[\s,"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV de coleção no formato da Liga, igual a um arquivo exportado por ela:
 * separador vírgula, cabeçalhos sem acento, sigla da edição em minúsculas,
 * Qualidade/Idioma vazios quando não informados, "Foil" em Extras.
 */
export function toLigaCsv(entries: SessionEntry[], scope: ExportScope, game: GameProvider, minBrl = 0): string {
  const liga = game.liga!;
  const header = [
    'Edicao (PTBR)',
    'Edicao (EN)',
    'Edicao (Sigla)',
    'Card (PT)',
    'Card (EN)',
    'Quantidade',
    'Qualidade (M NM SP MP HP D)',
    'Idioma (BR EN DE ES FR IT JP KO RU TW)',
    'Raridade (M R U C)',
    'Cor (W U B R G M A L)',
    'Extras',
    'Card #',
    'Comentario',
  ];
  const rows = group(entries, scope, true, minBrl).map(({ name, count, entry: e }) => {
    const number = e.printing?.number ?? null;
    // Sem edição identificada, a sigla fica em branco (a "mais cara" cadastraria a
    // carta na edição errada — ex.: um Lightning Bolt comum como Alpha).
    const set = e.printing?.set ?? e.set ?? '';
    const setName = e.printing?.setName ?? (e.set ? (e.price?.maxSetName ?? '') : '');
    const extras = e.finish === 'foil' ? liga.extras.foil : e.finish === 'etched' ? liga.extras.etched : '';
    const lang = ligaLanguage(e);
    return [
      '',
      setName,
      set ? liga.setCode(set, number) : '',
      lang === 'BR' ? (e.printedName ?? '') : '',
      name,
      count,
      e.condition ? LIGA_QUALITY[e.condition] : '',
      lang,
      '',
      '',
      extras,
      liga.cardNumber(number),
      '',
    ];
  });
  return [header, ...rows].map((r) => r.map(ligaCell).join(',')).join('\n');
}

/**
 * Codificação do arquivo da Liga: marca UTF-8 (BOM) no início e o texto em
 * Windows-1252 (acentos com 1 byte). Caracteres fora desse padrão viram "?".
 */
export function encodeLiga(text: string): Uint8Array {
  const cp1252: Record<number, number> = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
    0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
    0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
    0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  };
  const out = [0xef, 0xbb, 0xbf];
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out.push(c);
    else out.push(cp1252[c] ?? 0x3f);
  }
  return Uint8Array.from(out);
}

/** Lista de texto no formato da Liga: "1 Lightning Bolt [M10]". */
export function toLigaText(entries: SessionEntry[], scope: ExportScope, game: GameProvider, minBrl = 0): string {
  const liga = game.liga!;
  return group(entries, scope, true, minBrl)
    .map(({ name, count, entry: e }) => {
      const set = e.printing?.set ?? e.set;
      return `${count} ${name}${set ? ` [${liga.setCode(set, e.printing?.number ?? null)}]` : ''}`;
    })
    .join('\n');
}

export function exportContent(
  entries: SessionEntry[],
  scope: ExportScope,
  format: ExportFormat,
  game: GameProvider,
  minBrl = 0,
) {
  const date = new Date().toISOString().slice(0, 10);
  if (format === 'ligaCsv' && game.liga) {
    const text = toLigaCsv(entries, scope, game, minBrl);
    // Arquivo com a mesma codificação do exportado pela Liga (ver encodeLiga).
    return { text, bytes: encodeLiga(text), filename: `liga-${game.id}-${date}.csv`, mime: 'text/csv', bom: false };
  }
  if (format === 'ligaText' && game.liga) {
    return { text: toLigaText(entries, scope, game, minBrl), filename: `liga-${game.id}-${date}.txt`, mime: 'text/plain', bom: false };
  }
  return format === 'csv'
    ? { text: toCsv(entries, scope, minBrl), filename: `bulk-scanner-${game.id}-${date}.csv`, mime: 'text/csv', bom: true }
    : {
        text: toDecklistText(entries, scope, game, format === 'textWithSet', minBrl),
        filename: `bulk-scanner-${game.id}-${date}.txt`,
        mime: 'text/plain',
        bom: false,
      };
}
