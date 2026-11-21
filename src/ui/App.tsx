import { useCallback, useEffect, useRef, useState } from 'react';
import { listCameras, startCamera, stopCamera, type CameraDevice } from '../core/camera/cameraService';
import { screenRectToVideoRect, subRect } from '../core/camera/geometry';
import { defaultGame } from '../core/games/registry';
import { FuzzyMatcher } from '../core/matching/fuzzyMatcher';
import { TesseractEngine } from '../core/ocr/tesseractEngine';
import { Scanner, type ScanRead } from '../core/scanner/scanner';

/**
 * PROTÓTIPO (Etapa 1): câmera + OCR do nome + correção pela lista de nomes.
 * Mostra números de diagnóstico para medirmos velocidade e precisão.
 */

const BASE = import.meta.env.BASE_URL;
const game = defaultGame;

function loadPref(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: ignora */
  }
}

interface HistoryItem {
  name: string;
  at: number;
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const engineRef = useRef<TesseractEngine | null>(null);
  const scannerRef = useRef<Scanner | null>(null);
  const matcherRef = useRef<FuzzyMatcher | null>(null);
  const timesRef = useRef<number[]>([]);

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState('não carregado');
  const [namesStatus, setNamesStatus] = useState('carregando…');
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState(() => loadPref('cameraId', ''));
  const [guideSize, setGuideSize] = useState(() => Number(loadPref('guideSize', '0.8')));
  const [read, setRead] = useState<ScanRead | null>(null);
  const [readsPerSec, setReadsPerSec] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Lista de nomes: carrega assim que a página abre.
  useEffect(() => {
    game
      .loadNames(BASE)
      .then(({ entries, updatedAt }) => {
        const m = new FuzzyMatcher(entries);
        matcherRef.current = m;
        scannerRef.current?.setMatcher(m);
        const date = updatedAt ? new Date(updatedAt).toLocaleDateString('pt-BR') : '?';
        setNamesStatus(`${m.size.toLocaleString('pt-BR')} nomes (atualizado em ${date})`);
      })
      .catch((e: Error) => setNamesStatus(`indisponível — ${e.message}`));
  }, []);

  const getNameRect = useCallback(() => {
    const video = videoRef.current;
    const guide = guideRef.current;
    if (!video || !guide) return null;
    const g = guide.getBoundingClientRect();
    const screenRect = subRect({ x: g.left, y: g.top, w: g.width, h: g.height }, game.nameRegion);
    return screenRectToVideoRect(screenRect, video);
  }, []);

  const onRead = useCallback((r: ScanRead) => {
    setRead(r);
    // Copia o recorte para a miniatura de diagnóstico.
    const prev = previewRef.current;
    if (prev) {
      prev.width = r.crop.width;
      prev.height = r.crop.height;
      prev.getContext('2d')!.drawImage(r.crop, 0, 0);
    }
    // Leituras por segundo (média das últimas 10).
    const now = performance.now();
    const times = timesRef.current;
    times.push(now);
    if (times.length > 10) times.shift();
    if (times.length > 1) setReadsPerSec(((times.length - 1) * 1000) / (now - times[0]));

    const name = r.confirmed ? r.match?.cardName : undefined;
    if (name) {
      setHistory((h) => (h[0]?.name === name ? h : [{ name, at: Date.now() }, ...h].slice(0, 30)));
    }
  }, []);

  async function start(chosenId = deviceId) {
    setBusy(true);
    setError(null);
    try {
      const video = videoRef.current!;
      stopCamera(streamRef.current);
      const cameraPromise = startCamera(video, chosenId || undefined);
      if (!engineRef.current) {
        const engine = new TesseractEngine(`${BASE}tesseract/`, game.nameCharWhitelist);
        setOcrStatus('carregando…');
        await engine.init((msg) => setOcrStatus(msg));
        engineRef.current = engine;
        setOcrStatus('pronto');
      }
      streamRef.current = await cameraPromise;
      // Os nomes das câmeras só aparecem depois da permissão.
      setCameras(await listCameras());
      const activeId = streamRef.current.getVideoTracks()[0]?.getSettings().deviceId;
      if (activeId) setDeviceId(activeId);

      if (!scannerRef.current) {
        scannerRef.current = new Scanner({
          video,
          engine: engineRef.current,
          matcher: matcherRef.current,
          getNameRect,
          onRead,
        });
      }
      scannerRef.current.start();
      setRunning(true);
    } catch (e) {
      const err = e as Error;
      setError(
        err.name === 'NotAllowedError'
          ? 'Permissão da câmera negada. Libere a câmera nas configurações do navegador e tente de novo.'
          : err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  function stop() {
    scannerRef.current?.stop();
    stopCamera(streamRef.current);
    streamRef.current = null;
    setRunning(false);
  }

  function changeCamera(id: string) {
    setDeviceId(id);
    savePref('cameraId', id);
    if (running) void start(id);
  }

  function changeGuide(v: number) {
    setGuideSize(v);
    savePref('guideSize', String(v));
  }

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = game.nameRegion;
  const status = read?.match
    ? read.confirmed
      ? 'confirmed'
      : 'tentative'
    : 'none';

  return (
    <div className="app">
      <header className="topbar">
        <strong>Bulk Scanner</strong>
        <span className="tag">protótipo OCR</span>
        <div className="spacer" />
        {cameras.length > 1 && (
          <select value={deviceId} onChange={(e) => changeCamera(e.target.value)} aria-label="Câmera">
            {cameras.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        {running ? (
          <button onClick={stop}>Parar</button>
        ) : (
          <button className="primary" onClick={() => start()} disabled={busy}>
            {busy ? 'Iniciando…' : 'Iniciar'}
          </button>
        )}
      </header>

      <div className="stage">
        <video ref={videoRef} playsInline muted autoPlay />
        <div
          ref={guideRef}
          className="guide"
          style={{ '--g': guideSize, '--aspect': game.cardAspect } as React.CSSProperties}
        >
          <div
            className={`name-band ${status}`}
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
          />
        </div>
        {!running && !busy && (
          <div className="hint">
            Toque em <b>Iniciar</b> e encaixe a carta na moldura, com o nome dentro da faixa.
          </div>
        )}
      </div>

      <section className="panel">
        {error && <div className="error">{error}</div>}

        <div className={`result ${status}`}>
          {read?.match ? read.match.cardName : read ? '—' : ' '}
        </div>

        <div className="metrics">
          <span>OCR leu: <code>{read?.rawText || '…'}</code></span>
          <span>
            Palpite: {read?.bestGuess ? `${read.bestGuess.cardName} (${Math.round(read.bestGuess.score * 100)}%)` : '—'}
          </span>
          <span>OCR: {read ? Math.round(read.ocrMs) : '–'} ms</span>
          <span>Correção: {read ? read.matchMs.toFixed(1) : '–'} ms</span>
          <span>{readsPerSec.toFixed(1)} leituras/s</span>
        </div>

        <div className="row">
          <canvas ref={previewRef} className="preview" aria-label="Recorte enviado ao OCR" />
          <label className="slider">
            Tamanho da moldura
            <input
              type="range"
              min={0.3}
              max={0.98}
              step={0.01}
              value={guideSize}
              onChange={(e) => changeGuide(Number(e.target.value))}
            />
          </label>
        </div>

        <details>
          <summary>Cartas confirmadas ({history.length})</summary>
          <ol className="history">
            {history.map((h) => (
              <li key={h.at}>{h.name}</li>
            ))}
          </ol>
          {history.length > 0 && <button onClick={() => setHistory([])}>Limpar lista</button>}
        </details>

        <footer className="status">
          OCR: {ocrStatus} · Nomes: {namesStatus}
        </footer>
      </section>
    </div>
  );
}
