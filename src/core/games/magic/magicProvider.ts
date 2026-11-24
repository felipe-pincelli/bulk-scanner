import { parseIndex } from '../indexFormat';
import type { GameProvider } from '../types';

/**
 * Siglas da LigaMagic que diferem das oficiais (Scryfall). A Liga usa as siglas
 * oficiais em minúsculas, exceto em algumas edições antigas (códigos de 2 letras).
 * Confirmadas por um arquivo exportado da Liga: usg, lrw, pcy, scg, vis, sta, tsb.
 * As demais seguem o mesmo padrão clássico de 2 letras (dedução, a confirmar).
 */
const LIGA_SET_CODES: Record<string, string> = {
  // confirmadas
  usg: 'us',
  lrw: 'lw',
  pcy: 'pr',
  scg: 'sc',
  vis: 'vi',
  sta: 'soa',
  tsb: 'tsts',
  // padrão clássico de 2 letras (a confirmar)
  mir: 'mi',
  wth: 'wl',
  tmp: 'te',
  sth: 'sh',
  exo: 'ex',
  ulg: 'ul',
  uds: 'ud',
  mmq: 'mm',
  nem: 'ne',
  inv: 'in',
  pls: 'ps',
  apc: 'ap',
  ody: 'od',
  tor: 'tr',
  jud: 'ju',
  ons: 'on',
  lgn: 'le',
  mor: 'mt',
};

export const magicProvider: GameProvider = {
  id: 'magic',
  displayName: 'Magic: The Gathering',
  shortName: 'Magic',
  cardAspect: 63 / 88,
  // Faixa do nome no frame moderno (usada como referência de tamanho das letras).
  nameRegion: { x: 0.065, y: 0.04, w: 0.72, h: 0.065 },
  // Topo da área de detecção, largura inteira, 28% da altura: aceita a carta um
  // pouco deslocada, menor ou maior que a moldura.
  nameSearchBand: { x: 0, y: 0, w: 1, h: 0.28 },
  nameCharWhitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ',-",
  // Cartas em escrita não latina: identificadas pelo rodapé ("ONE • PH" + número),
  // que é latino em cartas de 2015 em diante. Japonês também pelo nome.
  lotLanguages: [
    { id: 'latin', label: 'inglês/português', footerOnly: false },
    // Japonês: lê o nome em japonês (cartas antigas) e, se não reconhecer, o rodapé.
    { id: 'ja', label: 'japonês', footerOnly: false, ocrLang: 'jpn', footerFallback: true },
    { id: 'ph', label: 'phyrexiano', footerOnly: true },
    { id: 'ko', label: 'coreano', footerOnly: true },
    { id: 'zh', label: 'chinês', footerOnly: true },
    { id: 'ru', label: 'russo', footerOnly: true },
  ],
  indexFile: 'data/magic-index.json',
  parseIndex: (json) => parseIndex(json, { splitFaces: true }),
  geometry: {
    barLeft: 0.045, // a barra do nome começa a 4,5% da largura
    barWidth: 0.91, // e ocupa 91% da largura
    nameCenterY: 0.0725,
    // Canto inferior esquerdo (frame 2015+): "117/384 R" e "2X2 • EN".
    footer: { x: 0.03, y: 0.895, w: 0.62, h: 0.09 },
    footerTextH: 0.012,
  },
  finishLabels: { nonfoil: 'normal', foil: 'foil', etched: 'foil etched', '': '' },
  exportWithSet: {
    label: 'Lista com edição — Moxfield, Archidekt, ManaBox',
    // Formato do Moxfield: "1 Lightning Bolt (2X2) 117 *F*" (*F* = foil, *E* = etched).
    line: (count, name, set, number, finish) =>
      `${count} ${name} (${set.toUpperCase()})${number ? ` ${number}` : ''}` +
      (finish === 'foil' ? ' *F*' : finish === 'etched' ? ' *E*' : ''),
  },
  exportPlainLabel: 'Lista simples (só nome) — qualquer site (MTGGoldfish, TappedOut…)',
  importHint: 'No site, procure "Import" / "Importar" e cole a lista. Ex.: Moxfield → Collection ou um deck novo → Import.',
  liga: {
    siteName: 'LigaMagic',
    setCode: (set) => LIGA_SET_CODES[set] ?? set.toLowerCase(),
    cardNumber: (n) => n ?? '',
    extras: { foil: 'Foil', etched: 'Foil Etched' },
  },
};
