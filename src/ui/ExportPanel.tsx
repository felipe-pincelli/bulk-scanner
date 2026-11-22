import { useState } from 'react';
import { countExport, exportContent, type ExportFormat, type ExportScope } from '../core/session/exportList';
import type { SessionEntry } from '../core/session/session';
import type { GameProvider } from '../core/games/types';
import { loadPref, savePref } from '../core/settings/settings';

/** Bloco "Exportar" do resumo: escolhe cartas e formato; copia, baixa ou compartilha. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function ExportPanel({ entries, game, minBrl }: { entries: SessionEntry[]; game: GameProvider; minBrl: number }) {
  const [scope, setScope] = useState<ExportScope>(() => loadPref('exportScope', 'alerts') as ExportScope);
  const [format, setFormat] = useState<ExportFormat>(() => {
    const f = loadPref('exportFormat', 'textWithSet');
    return f === 'csv' || f === 'text' ? f : 'textWithSet';
  });
  const [done, setDone] = useState('');

  const count = countExport(entries, scope, minBrl);
  const content = exportContent(entries, scope, format, game, minBrl);
  const file = () => new File([content.bom ? '\uFEFF' : '', content.text], content.filename, { type: content.mime });
  const canShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file()] });

  function flashDone(msg: string) {
    setDone(msg);
    setTimeout(() => setDone(''), 2000);
  }

  function download() {
    const url = URL.createObjectURL(file());
    const a = document.createElement('a');
    a.href = url;
    a.download = content.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashDone('Arquivo baixado');
  }

  async function share() {
    try {
      await navigator.share({ files: [file()], title: 'Bulk Scanner' });
    } catch {
      /* usuário cancelou */
    }
  }

  return (
    <details className="export">
      <summary>Exportar ({game.id === 'magic' ? 'Moxfield, Archidekt, planilha…' : 'lista, planilha…'})</summary>
      <div className="settings">
        <label>
          Quais cartas
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value as ExportScope);
              savePref('exportScope', e.target.value);
            }}
          >
            <option value="alerts">Só as com alerta (amarelo/vermelho)</option>
            <option value="alertsAndChecks">Com alerta + "confira a edição"</option>
            <option value="all">Todas as cartas lidas</option>
          </select>
        </label>
        <label>
          Formato
          <select
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as ExportFormat);
              savePref('exportFormat', e.target.value);
            }}
          >
            <option value="textWithSet">{game.exportWithSet.label}</option>
            <option value="text">{game.exportPlainLabel}</option>
            <option value="csv">CSV — planilha (Excel, Google Sheets) com preços</option>
          </select>
        </label>
        <textarea className="export-preview" readOnly value={content.text} rows={Math.min(8, Math.max(3, count + 1))} />
        <p className="muted small">
          {format === 'csv'
            ? 'Abra o arquivo .csv no Excel, Google Sheets ou Numbers.'
            : game.importHint}{' '}
          {format === 'textWithSet' && 'Cartas sem edição identificada saem só com o nome. '}
          {count} {count === 1 ? 'carta' : 'cartas'}.
        </p>
        <div className="row">
          <button className="small" disabled={!count} onClick={() => copyText(content.text).then(() => flashDone('Copiado!'))}>
            Copiar
          </button>
          <button className="small" disabled={!count} onClick={download}>
            Baixar arquivo
          </button>
          {canShareFile && (
            <button className="small" disabled={!count} onClick={share}>
              Compartilhar…
            </button>
          )}
          {done && <span className="muted small">{done}</span>}
        </div>
      </div>
    </details>
  );
}
