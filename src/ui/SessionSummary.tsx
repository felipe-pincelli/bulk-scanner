import { useState } from 'react';
import { ExportPanel } from './ExportPanel';
import type { GameProvider } from '../core/games/types';
import { CONDITIONS, effectiveLevel, entryRangeUsd, finishOptions, type Condition, type Finish } from '../core/session/finish';
import { CONDITION_NAME } from '../core/prices/copyPrice';
import { formatBrl, sessionToText, summarize, type Session, type SessionEntry } from '../core/session/session';

/**
 * Tela de resumo da sessão: cartas com alerta, total estimado e ações
 * (marcar normal/foil/especial, remover alerta falso, copiar, exportar,
 * continuar, nova sessão).
 */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function EntryRow({
  e,
  game,
  minBrl,
  onRemove,
  onFinish,
  onCondition,
}: {
  e: SessionEntry;
  game: GameProvider;
  minBrl: number;
  onRemove: () => void;
  onFinish: (f: Finish) => void;
  onCondition: (c: Condition) => void;
}) {
  const p = e.price;
  const r = entryRangeUsd(e);
  const options = finishOptions(e);
  return (
    <li className={`entry lvl-${effectiveLevel(e, minBrl)}`}>
      <div className="entry-main">
        <strong>
          {e.cardName}
          {e.printedName && <span className="muted small"> ({e.printedName})</span>}
          {e.lang && <span className="muted small"> · {e.lang}</span>}
        </strong>
        <span className="entry-price">
          {r.min === r.max ? formatBrl(r.max, e.usdBrl) : `${formatBrl(r.min, e.usdBrl)} – ${formatBrl(r.max, e.usdBrl)}`}
        </span>
      </div>
      <div className="entry-sub">
        {e.printing
          ? `${e.printing.setName} (${e.printing.set.toUpperCase()}) · nº ${e.printing.number}`
          : e.set
            ? `${p?.maxSetName || e.set.toUpperCase()} (${e.set.toUpperCase()}) · versão não identificada`
            : p?.maxSetName
              ? `Edição não identificada · mais cara: ${p.maxSetName}${p.maxFinish && p.maxFinish !== 'nonfoil' ? ` (${game.finishLabels[p.maxFinish]})` : ''}`
              : 'Sem preço'}
        <button className="link" onClick={onRemove} aria-label={`Remover ${e.cardName}`}>
          remover
        </button>
      </div>
      {options.length > 1 && (
        <div className="finish" role="group" aria-label="Acabamento">
          {options.map((f) => (
            <button
              key={f}
              className={`chip ${e.finish === f ? 'on' : ''}`}
              aria-pressed={e.finish === f}
              onClick={() => onFinish(f)}
            >
              {game.finishLabels[f]}
            </button>
          ))}
          {!e.finish && <span className="muted small">toque para informar</span>}
        </div>
      )}
      <div className="finish" role="group" aria-label="Condição">
        {CONDITIONS.map((c) => (
          <button
            key={c}
            className={`chip small-chip ${e.condition === c ? 'on' : ''}`}
            aria-pressed={e.condition === c}
            title={CONDITION_NAME[c]}
            onClick={() => onCondition(c)}
          >
            {c}
          </button>
        ))}
        {!e.condition && <span className="muted small">condição</span>}
      </div>
    </li>
  );
}

export function SessionSummaryView({
  game,
  session,
  minBrl,
  onRemove,
  onFinish,
  onCondition,
  onContinue,
  onNewSession,
}: {
  game: GameProvider;
  session: Session;
  minBrl: number;
  onRemove: (id: string) => void;
  onFinish: (id: string, f: Finish) => void;
  onCondition: (id: string, c: Condition) => void;
  onContinue: () => void;
  onNewSession: () => void;
}) {
  const s = summarize(session, minBrl);
  const [copied, setCopied] = useState(false);
  const row = (e: SessionEntry) => (
    <EntryRow
      key={e.id}
      e={e}
      game={game}
      minBrl={minBrl}
      onRemove={() => onRemove(e.id)}
      onFinish={(f) => onFinish(e.id, f)}
      onCondition={(c) => onCondition(e.id, c)}
    />
  );

  async function copy() {
    const text = sessionToText(s, session.startedAt);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Navegadores antigos: método alternativo.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function confirmNew() {
    if (s.scanned === 0 || window.confirm('Começar uma nova sessão? A lista atual será apagada.')) onNewSession();
  }

  return (
    <div className="summary" role="dialog" aria-label="Resumo da sessão">
      <div className="summary-inner">
        <header>
          <h2>Resumo da sessão · {game.shortName}</h2>
          <p className="muted">
            {new Date(session.startedAt).toLocaleString('pt-BR')} · {s.scanned} cartas lidas
            {s.durationMin > 0 && ` em ${s.durationMin} min`}
          </p>
        </header>

        <div className="totals">
          <div>
            <span className="muted">Cartas com alerta</span>
            <b>{s.alerts.length}</b>
          </div>
          <div>
            <span className="muted">Total estimado</span>
            <b>{brl.format(s.totalMinBrl)}</b>
            {s.totalMaxBrl > s.totalMinBrl && (
              <span className="muted small">até {brl.format(s.totalMaxBrl)} se forem as edições mais caras</span>
            )}
          </div>
        </div>

        <p className="muted small">
          O app não detecta foil nem condição pela câmera: marque em cada carta o acabamento (
          {game.finishLabels.nonfoil}, {game.finishLabels.foil} ou {game.finishLabels.etched}) e a condição (NM, SP, MP,
          HP, DMG). O preço, o total e a exportação se ajustam. Condição abaixo de NM aplica um desconto aproximado
          (SP 85%, MP 70%, HP 50%, DMG 35%).
        </p>

        {s.alerts.length === 0 && <p className="muted">Nenhuma carta passou do valor mínimo nesta sessão.</p>}
        <ol className="entries">{s.alerts.map(row)}</ol>

        {s.checks.length > 0 && (
          <details open>
            <summary>Confira a edição ou o acabamento ({s.checks.length})</summary>
            <p className="muted small">
              Só alguma edição específica (ou a versão {game.finishLabels.foil}/{game.finishLabels.etched}) destas cartas
              vale o mínimo. Olhe a carta e marque o acabamento.
            </p>
            <ol className="entries">{s.checks.map(row)}</ol>
          </details>
        )}

        {s.others.length > 0 && (
          <details>
            <summary>Outras cartas lidas ({s.others.length})</summary>
            <p className="muted small">Sem alerta. Se alguma for {game.finishLabels.foil}, marque aqui: ela pode passar a valer.</p>
            <ol className="entries">{s.others.map(row)}</ol>
          </details>
        )}

        <ExportPanel entries={session.entries} game={game} minBrl={minBrl} />

        <div className="summary-actions">
          <button onClick={copy} disabled={s.scanned === 0}>
            {copied ? 'Copiado!' : 'Copiar resumo'}
          </button>
          <button onClick={confirmNew}>Nova sessão</button>
          <button className="primary" onClick={onContinue}>
            Continuar escaneando
          </button>
        </div>
      </div>
    </div>
  );
}
