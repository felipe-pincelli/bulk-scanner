import type { PriceInfo, Printing } from '../games/types';
import { priceForPrintings } from '../edition/editionPrice';
import { adjustPrice, type CopyInfo } from '../prices/copyPrice';
import type { EditionResult } from '../edition/parseFooter';
import type { ScanRead } from '../scanner/scanner';
import { evaluateAlert, type AlertDecision, type AlertSettings } from './alertRules';
import { CardPresence } from './cardPresence';

/**
 * Decide QUANDO e COMO alertar para cada carta que aparece na câmera.
 *
 * - Se o alerta não depende da edição (ex.: Moat, cara em qualquer versão; ou
 *   uma carta barata em todas as versões), decide na hora.
 * - Se depende (só alguma edição vale o mínimo), espera algumas leituras pela
 *   leitura do rodapé. Edição identificada → alerta com o preço exato. Não
 *   identificada a tempo → alerta como antes (azul "confira a edição", ou pelo
 *   preço máximo no critério "qualquer edição").
 * - Se a carta já vale o mínimo mas alguma edição vale 5× (amarelo que pode ser
 *   vermelho), alerta amarelo NA HORA e continua lendo o rodapé; se for a edição
 *   cara, manda uma correção (`replaces`) que sobe o alerta para vermelho.
 */
export interface CardEvent {
  cardName: string;
  decision: AlertDecision;
  /** Preço usado na decisão (da impressão exata/edição, se identificada). */
  price: PriceInfo | null;
  /** Impressão exata identificada pelo rodapé. */
  printing: Printing | null;
  /** Edição identificada (mesmo sem saber a versão exata). */
  set: string | null;
  /** true = corrige o evento anterior desta mesma carta (edição lida depois). */
  replaces?: boolean;
}

/** Carta com uma impressão só: já se sabe qual é, sem ler o rodapé. */
function onlyPrinting(price: PriceInfo | null): { printing: Printing | null; set: string | null } {
  const only = price?.printings?.length === 1 ? price.printings[0] : null;
  return { printing: only, set: only?.set ?? null };
}

interface Pending {
  cardName: string;
  price: PriceInfo;
  fallback: AlertDecision;
  best: EditionResult | null;
  reads: number;
  /** 'wait' = alerta ainda não saiu; 'refine' = já saiu, só corrige se mudar. */
  mode: 'wait' | 'refine';
}

export class AlertFlow {
  private presence = new CardPresence();
  private pending: Pending | null = null;

  constructor(
    private deps: {
      getPrice: (cardName: string) => PriceInfo | undefined;
      getRate: () => number | null;
      getSettings: () => AlertSettings;
      /** Acabamento/condição informados para as próximas cartas (lote). */
      getCopy?: () => CopyInfo;
      /** Leituras a esperar pela edição antes de desistir (~4 = 1 s). */
      maxWaitReads?: number;
    },
  ) {}

  /** O preço desta carta depende da edição? (então vale ler o rodapé) */
  needsEdition(cardName: string): Printing[] | null {
    const price = this.deps.getPrice(cardName);
    if (!price?.printings || price.printings.length < 2) return null;
    return this.isAmbiguous(price) ? price.printings : null;
  }

  /** Nível (0 nada, 1 amarelo, 2 vermelho) que um valor em US$ atingiria. */
  private tier(usd: number | null): number {
    const rate = this.deps.getRate() ?? 0;
    const min = this.deps.getSettings().minBrl;
    const brl = (usd ?? 0) * rate;
    return brl >= min * 5 ? 2 : brl >= min ? 1 : 0;
  }

  /** Ambíguo: a versão mais barata e a mais cara caem em níveis de alerta diferentes. */
  private isAmbiguous(raw: PriceInfo): boolean {
    if (!this.deps.getRate()) return false;
    const s = this.deps.getSettings();
    const price = this.adjust(raw);
    const maxUsd = s.includeFoil ? price.maxUsd : (price.maxNonfoilUsd ?? price.maxUsd);
    return this.tier(price.minUsd) !== this.tier(maxUsd);
  }

  /** Preço desta cópia, com o acabamento/condição do lote (se informados). */
  private adjust(price: PriceInfo, printing?: Printing | null): PriceInfo {
    const copy = this.deps.getCopy?.() ?? {};
    return copy.finish || copy.condition ? adjustPrice(price, copy, printing) : price;
  }

  private decide(price: PriceInfo | null, printing?: Printing | null): AlertDecision {
    return evaluateAlert(price ? this.adjust(price, printing) : undefined, this.deps.getRate(), this.deps.getSettings());
  }

  private eventFor(p: Pending): CardEvent | null {
    const ev = this.resolve(p);
    if (p.mode === 'wait') return ev;
    // Modo "refinar": só manda correção se a edição foi lida e mudou o resultado.
    if (!ev.printing && !ev.set) return null;
    return { ...ev, replaces: true };
  }

  private resolve(p: Pending): CardEvent {
    const r = p.best;
    if (r?.printing) {
      const price = priceForPrintings([r.printing]);
      return { cardName: p.cardName, decision: this.decide(price, r.printing), price, printing: r.printing, set: r.set };
    }
    if (r?.set && r.candidates.length) {
      const price = priceForPrintings(r.candidates);
      return { cardName: p.cardName, decision: this.decide(price), price, printing: null, set: r.set };
    }
    return { cardName: p.cardName, decision: p.fallback, price: p.price, ...onlyPrinting(p.price) };
  }

  /** Última leitura de rodapé, por carta (pode chegar antes da carta ser confirmada). */
  private lastEdition: { cardName: string; best: EditionResult | null; done: boolean } | null = null;

  private rememberEdition(read: ScanRead) {
    const e = read.edition;
    if (!e) return;
    // Nova série de tentativas (outra carta, ou a mesma carta que saiu e voltou).
    if (this.lastEdition?.cardName !== e.cardName || e.attempts === 1) {
      this.lastEdition = { cardName: e.cardName, best: null, done: false };
    }
    const cur = this.lastEdition;
    const r = e.result;
    if (r && (r.printing || (r.set && !cur.best?.printing))) cur.best = r;
    cur.done = e.done;
  }

  /** Processa uma leitura; devolve as cartas "fechadas" nesta leitura (0, 1 ou 2). */
  onRead(read: ScanRead): CardEvent[] {
    const events: CardEvent[] = [];
    this.rememberEdition(read);

    const appeared = this.presence.update(read.match?.cardName ?? null, read.confirmed);
    // Outra carta apareceu: fecha a pendente com o que tiver.
    const push = (ev: CardEvent | null) => ev && events.push(ev);
    if (this.pending && appeared) {
      push(this.eventFor(this.pending));
      this.pending = null;
    }

    if (appeared) {
      const price = this.deps.getPrice(appeared) ?? null;
      const decision = this.decide(price);
      const event: CardEvent = { cardName: appeared, decision, price, ...onlyPrinting(price) };
      if (price && this.needsEdition(appeared)) {
        const known = this.lastEdition?.cardName === appeared ? this.lastEdition.best : null;
        const pending: Pending = { cardName: appeared, price, fallback: decision, best: known, reads: 0, mode: 'wait' };
        if (known?.printing) {
          // O rodapé já foi lido antes da confirmação: alerta direto com o preço exato.
          push(this.resolve(pending));
        } else {
          // Já é amarelo/vermelho de qualquer jeito? Alerta agora e só refina depois.
          const alertsAnyway = decision.level === 'yellow' || decision.level === 'red';
          if (alertsAnyway) push(event);
          this.pending = { ...pending, mode: alertsAnyway ? 'refine' : 'wait' };
        }
      } else {
        push(event);
      }
    }

    const p = this.pending;
    if (p) {
      const e = this.lastEdition?.cardName === p.cardName ? this.lastEdition : null;
      if (e?.best) p.best = e.best;
      p.reads++;
      // Fecha quando: edição exata identificada, rodapé desistiu, ou esperou demais.
      if (p.best?.printing || e?.done || p.reads > (this.deps.maxWaitReads ?? 6)) {
        push(this.eventFor(p));
        this.pending = null;
      }
    }
    return events;
  }

  reset() {
    this.presence.reset();
    this.pending = null;
    this.lastEdition = null;
  }
}
