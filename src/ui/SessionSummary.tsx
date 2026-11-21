import { useState } from 'react';
import { ExportPanel } from './ExportPanel';
import {
  formatBrl,
  sessionToText,
  summarize,
  type Session,
  type SessionEntry,
} from '../core/session/session';

/**
 * Tela de resumo da sessão: cartas que dispararam alerta, total estimado,
 * e ações (remover alerta falso, copiar lista, continuar, nova sessão).
 */
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const finish: Record<string, string> = { foil: ' foil', etched: ' foil etched', nonfoil: '', '': '' };

function EntryRow({ e, onRemove }: { e: SessionEntry; onRemove: () => void }) {
  const p = e.price;
  const single = p?.minUsd === p?.maxUsd;
  return (
    <li className={`entry ${e.level}`}>
      <div className="entry-main">
        <strong>{e.cardName}</strong>
        <span className="entry-price">
          {single ? formatBrl(p?.maxUsd, e.usdBrl) : `${formatBrl(p?.minUsd, e.usdBrl)} – ${formatBrl(p?.maxUsd, e.usdBrl)}`}
        </span>
      </div>
      <div className="entry-sub">
        {p?.maxSetName ? `Edição não identificada · mais cara: ${p.maxSetName}${finish[p.maxFinish] ?? ''}` : 'Sem preço'}
        <button className="link" onClick={onRemove} aria-label={`Remover ${e.cardName}`}>
          remover
        </button>
      </div>
    </li>
  );
}

export function SessionSummaryView({
  session,
  onRemove,
  onContinue,
  onNewSession,
}: {
  session: Session;
  onRemove: (id: string) => void;
  onContinue: () => void;
  onNewSession: () => void;
}) {
  const s = summarize(session);
  const [copied, setCopied] = useState(false);

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
          <h2>Resumo da sessão</h2>
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

        {s.alerts.length === 0 && <p className="muted">Nenhuma carta passou do valor mínimo nesta sessão.</p>}
        <ol className="entries">
          {s.alerts.map((e) => (
            <EntryRow key={e.id} e={e} onRemove={() => onRemove(e.id)} />
          ))}
        </ol>

        {s.checks.length > 0 && (
          <details>
            <summary>Confira a edição ({s.checks.length})</summary>
            <p className="muted small">
              Só alguma edição específica destas cartas vale o mínimo. Olhe o símbolo da edição na carta.
            </p>
            <ol className="entries">
              {s.checks.map((e) => (
                <EntryRow key={e.id} e={e} onRemove={() => onRemove(e.id)} />
              ))}
            </ol>
          </details>
        )}

        <ExportPanel entries={session.entries} />

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
