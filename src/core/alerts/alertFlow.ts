import type { PriceInfo, Printing } from '../games/types';
import { priceForPrintings } from '../edition/editionPrice';
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
}

interface Pending {
  cardName: string;
  price: PriceInfo;
  fallback: AlertDecision;
  best: EditionResult | null;
  reads: number;
}

export class AlertFlow {
  private presence = new CardPresence();
  private pending: Pending | null = null;

  constructor(
    private deps: {
      getPrice: (cardName: string) => PriceInfo | undefined;
      getRate: () => number | null;
      getSettings: () => AlertSettings;
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

  private isAmbiguous(price: PriceInfo): boolean {
    const rate = this.deps.getRate();
    const s = this.deps.getSettings();
    if (!rate) return false;
    const maxUsd = s.includeFoil ? price.maxUsd : (price.maxNonfoilUsd ?? price.maxUsd);
    // Ambíguo: a versão mais barata NÃO chega no mínimo, mas alguma versão chega.
    return (price.minUsd ?? 0) * rate < s.minBrl && (maxUsd ?? 0) * rate >= s.minBrl;
  }

  private decide(price: PriceInfo | null): AlertDecision {
    return evaluateAlert(price ?? undefined, this.deps.getRate(), this.deps.getSettings());
  }

  private eventFor(p: Pending): CardEvent {
    const r = p.best;
    if (r?.printing) {
      const price = priceForPrintings([r.printing]);
      return { cardName: p.cardName, decision: this.decide(price), price, printing: r.printing, set: r.set };
    }
    if (r?.set && r.candidates.length) {
      const price = priceForPrintings(r.candidates);
      return { cardName: p.cardName, decision: this.decide(price), price, printing: null, set: r.set };
    }
    return { cardName: p.cardName, decision: p.fallback, price: p.price, printing: null, set: null };
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
    if (this.pending && appeared) {
      events.push(this.eventFor(this.pending));
      this.pending = null;
    }

    if (appeared) {
      const price = this.deps.getPrice(appeared) ?? null;
      const decision = this.decide(price);
      if (price && this.needsEdition(appeared)) {
        this.pending = { cardName: appeared, price, fallback: decision, best: null, reads: 0 };
      } else {
        events.push({ cardName: appeared, decision, price, printing: null, set: null });
      }
    }

    const p = this.pending;
    if (p) {
      const e = this.lastEdition?.cardName === p.cardName ? this.lastEdition : null;
      if (e?.best) p.best = e.best;
      p.reads++;
      // Fecha quando: edição exata identificada, rodapé desistiu, ou esperou demais.
      if (p.best?.printing || e?.done || p.reads > (this.deps.maxWaitReads ?? 6)) {
        events.push(this.eventFor(p));
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
