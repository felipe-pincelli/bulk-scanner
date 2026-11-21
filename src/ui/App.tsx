import { useCallback, useEffect, useRef, useState } from 'react';
import { listCameras, startCamera, stopCamera, type CameraDevice } from '../core/camera/cameraService';
import { screenRectToVideoRect } from '../core/camera/geometry';
import { defaultGame } from '../core/games/registry';
import { FuzzyMatcher } from '../core/matching/fuzzyMatcher';
import { TesseractEngine } from '../core/ocr/tesseractEngine';
import { orientationLabel, rotateRegion } from '../core/scanner/orientation';
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
  const zoneRef = useRef<HTMLDivElement>(null);
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
  const [zoneSize, setZoneSize] = useState(() => Number(loadPref('zoneSize', '0.92')));
  const [autoRotate, setAutoRotate] = useState(() => loadPref('autoRotate', '1') === '1');
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

  const getZoneRect = useCallback(() => {
    const video = videoRef.current;
    const zone = zoneRef.current;
    if (!video || !zone) return null;
    const z = zone.getBoundingClientRect();
    return screenRectToVideoRect({ x: z.left, y: z.top, w: z.width, h: z.height }, video);
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
          game,
          getZoneRect,
          onRead,
          autoRotate,
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

  function changeZone(v: number) {
    setZoneSize(v);
    savePref('zoneSize', String(v));
  }

  function changeAutoRotate(on: boolean) {
    setAutoRotate(on);
    savePref('autoRotate', on ? '1' : '0');
    scannerRef.current?.setAutoRotate(on);
  }

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const band = rotateRegion(game.nameSearchBand, read?.orientation ?? 0);
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
        <div ref={zoneRef} className="zone" style={{ '--g': zoneSize } as React.CSSProperties}>
          <div className="card-ghost" style={{ '--aspect': game.cardAspect } as React.CSSProperties} />
          <div
            className={`name-band ${status}`}
            style={{
              left: `${band.x * 100}%`,
              top: `${band.y * 100}%`,
              width: `${band.w * 100}%`,
              height: `${band.h * 100}%`,
            }}
          />
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
        </div>
        {!running && !busy && (
          <div className="hint">
            Toque em <b>Iniciar</b> e coloque a carta dentro do quadrado — em pé ou deitada.
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
          <span>Orientação: {read ? orientationLabel[read.orientation] : '–'}</span>
          <span>OCR: {read ? Math.round(read.ocrMs) : '–'} ms</span>
          <span>Correção: {read ? read.matchMs.toFixed(1) : '–'} ms</span>
          <span>{readsPerSec.toFixed(1)} leituras/s</span>
        </div>

        <div className="row">
          <canvas ref={previewRef} className="preview" aria-label="Recorte enviado ao OCR" />
          <label className="slider">
            Tamanho da área de detecção
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.01}
              value={zoneSize}
              onChange={(e) => changeZone(Number(e.target.value))}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={autoRotate} onChange={(e) => changeAutoRotate(e.target.checked)} />
            Detectar carta deitada / de cabeça para baixo
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
