/**
 * Monta o ÍNDICE ENXUTO de um jogo, no formato comum que o app entende
 * (src/core/games/indexFormat.ts): uma linha por nome de carta com o menor e o
 * maior preço entre as impressões, mais o preço de cada impressão.
 */
import { writeFileSync } from 'node:fs';

export type Finish = 'nonfoil' | 'foil' | 'etched' | '';
/** [edição, nº de colecionador, preço normal, preço foil, preço etched/especial] (US$) */
export type PrintingRow = [set: string, number: string, usd: number | null, foil: number | null, etched: number | null];
export type IndexRow = [
  name: string,
  minUsd: number | null, // impressão mais barata (versão normal; se não houver, a foil)
  maxNonfoilUsd: number | null, // impressão normal mais cara
  maxUsd: number | null, // impressão mais cara, incluindo foil
  maxSet: string,
  maxSetName: string,
  maxFinish: Finish,
  printings?: PrintingRow[], // cartas com 2+ impressões, ou 1 com preço foil/especial
];

export class IndexBuilder {
  readonly rows = new Map<string, IndexRow>();
  readonly printings = new Map<string, PrintingRow[]>();
  readonly sets: Record<string, string> = {};
  readonly aliases: Record<string, string> = {};

  /** Registra que existe uma carta com esse nome (mesmo sem preço). */
  addName(name: string): IndexRow {
    let row = this.rows.get(name);
    if (!row) this.rows.set(name, (row = [name, null, null, null, '', '', '']));
    return row;
  }

  addPrinting(
    name: string,
    set: string,
    setName: string,
    number: string,
    usd: number | null,
    foil: number | null,
    etched: number | null,
  ) {
    const row = this.addName(name);
    if (usd !== null) {
      if (row[1] === null || usd < row[1]) row[1] = usd;
      if (row[2] === null || usd > row[2]) row[2] = usd;
    }
    for (const [price, finish] of [
      [usd, 'nonfoil'],
      [foil, 'foil'],
      [etched, 'etched'],
    ] as const) {
      if (price !== null && (row[3] === null || price > row[3])) {
        row[3] = price;
        row[4] = set;
        row[5] = setName;
        row[6] = finish;
      }
    }
    if (usd !== null || foil !== null || etched !== null) {
      this.sets[set] = setName;
      let list = this.printings.get(name);
      if (!list) this.printings.set(name, (list = []));
      list.push([set, number, usd, foil, etched]);
    }
  }

  /** Fecha o índice e grava o arquivo. Falha se vier pequeno demais (trava de segurança). */
  write(file: string, meta: { game: string; source: string; pricesUpdatedAt: string; usdBrl: number | null }, minNames: number) {
    // Cartas que só existem em foil: o "mais barato" é o foil mais barato.
    for (const row of this.rows.values()) if (row[1] === null && row[3] !== null) row[1] = row[3];
    let printingCount = 0;
    for (const [name, list] of this.printings) {
      // Guarda as impressões quando há mais de uma, ou quando a única tem preço
      // foil/especial (para o usuário poder marcar "foil" no resumo).
      if (list.length < 2 && list[0][3] === null && list[0][4] === null) continue;
      this.rows.get(name)![7] = list;
      printingCount += list.length;
    }
    if (this.rows.size < minNames) {
      throw new Error(`[${meta.game}] índice com só ${this.rows.size} nomes (esperado > ${minNames}). Nada foi gravado.`);
    }
    const index = {
      version: 2,
      ...meta,
      builtAt: new Date().toISOString(),
      rows: [...this.rows.values()].sort((a, b) => a[0].localeCompare(b[0])),
      aliases: this.aliases,
      sets: this.sets,
    };
    const json = JSON.stringify(index);
    writeFileSync(file, json);
    const withPrice = index.rows.filter((r) => r[3] !== null).length;
    console.log(
      `[${meta.game}] nomes: ${this.rows.size} (${withPrice} com preço) · apelidos: ${Object.keys(this.aliases).length}` +
        ` · impressões no índice: ${printingCount} · edições: ${Object.keys(this.sets).length}` +
        ` · arquivo: ${(json.length / 1e6).toFixed(1)} MB`,
    );
  }
}
