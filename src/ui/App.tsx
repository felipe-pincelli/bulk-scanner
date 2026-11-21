import { useCallback, useEffect, useRef, useState } from 'react';
import { listCameras, startCamera, stopCamera, type CameraDevice } from '../core/camera/cameraService';
import { screenRectToVideoRect } from '../core/camera/geometry';
import { defaultGame } from '../core/games/registry';
import type { PriceInfo } from '../core/games/types';
import { FuzzyMatcher } from '../core/matching/fuzzyMatcher';
import { loadCardIndex } from '../core/prices/cardDatabase';
import { formatPrice, getUsdBrl, type Rate } from '../core/prices/currency';
import { TesseractEngine } from '../core/ocr/tesseractEngine';
import { orientationLabel, rotateRegion } from '../core/scanner/orientation';
import { Scanner, type ScanRead } from '../core/scanner/scanner';
import { evaluateAlert, type AlertBasis, type AlertLevel, type AlertSettings } from '../core/alerts/alertRules';
import { CardPresence } from '../core/alerts/cardPresence';
import { createWebFeedback } from '../core/platform/feedback';
import { keepScreenOn } from '../core/platform/wakeLock';
import { loadPref, savePref } from '../core/settings/settings';
import { addEntry, loadSession, newSession, removeEntry, saveSession, type Session } from '../core/session/session';
import { SessionSummaryView } from './SessionSummary';

/**
 * Etapa 3: leitura contínua + preço em R$ + alertas (som + flash) com cooldown.
 * Toda a lógica fica em src/core; aqui é só a tela.
 */

const BASE = import.meta.env.BASE_URL;
const game = defaultGame;
const feedback = createWebFeedback();

const levelLabel: Record<AlertLevel, string> = {
  red: 'MUITO ACIMA DO MÍNIMO',
  yellow: 'ACIMA DO MÍNIMO',
  check: 'confira a edição',
  none: '',
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function loadAlertSettings(): AlertSettings {
  return {
    minBrl: Number(loadPref('minBrl', '10')) || 10,
    basis: (loadPref('alertBasis', 'safe') as AlertBasis) === 'max' ? 'max' : 'safe',
    includeFoil: loadPref('includeFoil', '1') === '1',
    checkCue: loadPref('checkCue', '1') === '1',
  };
}

const finishLabel: Record<PriceInfo['maxFinish'], string> = {
  nonfoil: 'normal',
  foil: 'foil',
  etched: 'foil etched',
  '': '',
};

function PriceLine({ info, rate }: { info: PriceInfo | undefined; rate: Rate | null }) {
  if (!info || info.maxUsd === null) return <div className="price none">sem preço no Scryfall</div>;
  const showNonfoil = info.maxNonfoilUsd !== null && info.maxNonfoilUsd !== info.maxUsd;
  return (
    <div className="price">
      <span className="range">
        {info.minUsd === info.maxUsd ? formatPrice(info.maxUsd, rate) : `${formatPrice(info.minUsd, rate)} – ${formatPrice(info.maxUsd, rate)}`}
      </span>
      <span className="detail">
        mais cara: {info.maxSetName} ({finishLabel[info.maxFinish]})
        {showNonfoil && ` · sem foil até ${formatPrice(info.maxNonfoilUsd, rate)}`}
      </span>
    </div>
  );
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
  const presenceRef = useRef(new CardPresence());
  const releaseWakeRef = useRef<(() => void) | null>(null);
  const pricesRef = useRef<Map<string, PriceInfo>>(new Map());
  const rateRef = useRef<Rate | null>(null);
  const alertRef = useRef<AlertSettings>(loadAlertSettings());

  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState('não carregado');
  const [dataStatus, setDataStatus] = useState('carregando…');
  const [dataWarning, setDataWarning] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [prices, setPrices] = useState<Map<string, PriceInfo>>(new Map());
  const [rate, setRate] = useState<Rate | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [deviceId, setDeviceId] = useState(() => loadPref('cameraId', ''));
  const [zoneSize, setZoneSize] = useState(() => Number(loadPref('zoneSize', '0.92')));
  const [autoRotate, setAutoRotate] = useState(() => loadPref('autoRotate', '1') === '1');
  const [read, setRead] = useState<ScanRead | null>(null);
  const [readsPerSec, setReadsPerSec] = useState(0);
  const [session, setSession] = useState<Session>(newSession);
  const [showSummary, setShowSummary] = useState(false);
  const sessionLoaded = useRef(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(alertRef.current);
  const [minInput, setMinInput] = useState(String(alertRef.current.minBrl));
  const [soundOn, setSoundOn] = useState(() => loadPref('sound', '1') === '1');
  const [flash, setFlash] = useState<{ level: AlertLevel; id: number } | null>(null);
  const [wakeInfo, setWakeInfo] = useState<string>('');

  useEffect(() => feedback.setSoundEnabled(soundOn), [soundOn]);
  // Sessão salva no aparelho: recupera ao abrir e salva a cada mudança.
  useEffect(() => {
    void loadSession().then((s) => {
      setSession((cur) => (cur.entries.length ? cur : s));
      sessionLoaded.current = true;
    });
  }, []);
  useEffect(() => {
    if (sessionLoaded.current) void saveSession(session);
  }, [session]);
  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);
  useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  // Índice de cartas/preços + cotação: carrega assim que a página abre.
  const loadData = useCallback(async (force: boolean) => {
    setUpdating(true);
    try {
      const { index, warning } = await loadCardIndex(game, BASE, force);
      const m = new FuzzyMatcher(index.entries);
      matcherRef.current = m;
      scannerRef.current?.setMatcher(m);
      setPrices(index.prices);
      setDataWarning(warning ?? null);
      const date = new Date(index.pricesUpdatedAt).toLocaleDateString('pt-BR');
      setDataStatus(`${index.prices.size.toLocaleString('pt-BR')} cartas · preços de ${date}`);
      setRate(await getUsdBrl({ usdBrl: index.usdBrl, at: index.builtAt }, force));
    } catch (e) {
      setDataStatus('indisponível');
      setDataWarning((e as Error).message);
    } finally {
      setUpdating(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

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

    // Carta nova na frente da câmera? (cooldown: a mesma carta só alerta uma vez)
    const appeared = presenceRef.current.update(r.match?.cardName ?? null, r.confirmed);
    if (appeared) {
      const decision = evaluateAlert(pricesRef.current.get(appeared), rateRef.current?.usdBrl ?? null, alertRef.current);
      if (decision.level !== 'none') {
        feedback.alert(decision.level);
        setFlash({ level: decision.level, id: performance.now() });
      }
      const price = pricesRef.current.get(appeared) ?? null;
      const usdBrl = rateRef.current?.usdBrl ?? null;
      setSession((s) => addEntry(s, { cardName: appeared, at: Date.now(), ...decision, price, usdBrl }));
    }
  }, []);

  function updateAlertSettings(patch: Partial<AlertSettings>) {
    const next = { ...alertRef.current, ...patch };
    alertRef.current = next;
    setAlertSettings(next);
    savePref('minBrl', String(next.minBrl));
    savePref('alertBasis', next.basis);
    savePref('includeFoil', next.includeFoil ? '1' : '0');
    savePref('checkCue', next.checkCue ? '1' : '0');
  }

  function changeMin(text: string) {
    setMinInput(text);
    const value = Number(text.replace(',', '.'));
    if (value > 0) updateAlertSettings({ minBrl: value });
  }

  function changeSound(on: boolean) {
    setSoundOn(on);
    savePref('sound', on ? '1' : '0');
  }

  async function testAlert(level: AlertLevel) {
    await feedback.unlock();
    feedback.alert(level);
    setFlash({ level, id: performance.now() });
  }

  async function start(chosenId = deviceId) {
    // Precisa ser a PRIMEIRA coisa do toque: o iPhone só libera o som assim.
    const unlocking = feedback.unlock().catch(() => {});
    setBusy(true);
    setError(null);
    try {
      await unlocking;
      if (!releaseWakeRef.current) {
        const wake = await keepScreenOn();
        releaseWakeRef.current = wake.release;
        setWakeInfo(wake.supported ? 'tela ligada' : 'este navegador não mantém a tela ligada');
      }
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

  function finish() {
    stop();
    setShowSummary(true);
  }

  function startNewSession() {
    setSession(newSession());
    setShowSummary(false);
    presenceRef.current.reset();
  }

  function stop() {
    scannerRef.current?.stop();
    stopCamera(streamRef.current);
    streamRef.current = null;
    releaseWakeRef.current?.();
    releaseWakeRef.current = null;
    presenceRef.current.reset();
    setWakeInfo('');
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
  const current = read?.match ? evaluateAlert(prices.get(read.match.cardName), rate?.usdBrl ?? null, alertSettings) : null;
  const history = [...session.entries].reverse();
  const alertCount = history.filter((h) => h.level === 'yellow' || h.level === 'red').length;

  return (
    <div className="app">
      <header className="topbar">
        <strong>Bulk Scanner</strong>
        <span className="tag">beta</span>
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
        {!running && session.entries.length > 0 && (
          <button onClick={() => setShowSummary(true)}>Resumo</button>
        )}
        {running ? (
          <button onClick={finish}>Parar</button>
        ) : (
          <button className="primary" onClick={() => start()} disabled={busy}>
            {busy ? 'Iniciando…' : session.entries.length ? 'Continuar sessão' : 'Iniciar sessão'}
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
            Toque em <b>Iniciar sessão</b> (libera o som) e coloque a carta dentro do quadrado — em pé ou
            deitada.
          </div>
        )}
      </div>

      {showSummary && (
        <SessionSummaryView
          session={session}
          onRemove={(id) => setSession((s) => removeEntry(s, id))}
          onContinue={() => {
            setShowSummary(false);
            void start();
          }}
          onNewSession={startNewSession}
        />
      )}
      {flash && <div key={flash.id} className={`flash ${flash.level}`} onAnimationEnd={() => setFlash(null)} />}

      <section className="panel">
        {error && <div className="error">{error}</div>}

        <div className={`result ${status}`}>
          {read?.match ? read.match.cardName : read ? '—' : ' '}
          {current && current.level !== 'none' && (
            <span className={`badge ${current.level}`}>{levelLabel[current.level]}</span>
          )}
        </div>
        {read?.match && <PriceLine info={prices.get(read.match.cardName)} rate={rate} />}

        <label className="min-row">
          Alertar a partir de
          <span className="money">
            R$
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={minInput}
              onChange={(e) => changeMin(e.target.value)}
            />
          </span>
          <span className="muted">vermelho a partir de {brl.format(alertSettings.minBrl * 5)}</span>
        </label>

        <details>
          <summary>
            Cartas da sessão ({history.length}
            {alertCount > 0 && `, ${alertCount} com alerta`})
          </summary>
          <ol className="history">
            {history.map((h) => {
              const p = h.price;
              return (
                <li key={h.id} className={h.level}>
                  {h.cardName}{' '}
                  <span className="muted">
                    — {formatPrice(p?.minUsd ?? null, rate)} a {formatPrice(p?.maxUsd ?? null, rate)}
                  </span>
                </li>
              );
            })}
          </ol>
          {history.length > 0 && (
            <button className="small" onClick={() => setShowSummary(true)}>
              Ver resumo
            </button>
          )}
        </details>

        <details>
          <summary>Alertas</summary>
          <div className="settings">
            <label>
              Critério
              <select
                value={alertSettings.basis}
                onChange={(e) => updateAlertSettings({ basis: e.target.value as AlertBasis })}
              >
                <option value="safe">Seguro: a versão mais barata já vale o mínimo</option>
                <option value="max">Qualquer edição: alguma versão vale o mínimo</option>
              </select>
            </label>
            <p className="muted">
              {alertSettings.basis === 'safe'
                ? 'Alerta só quando QUALQUER cópia da carta vale o mínimo. Se só uma edição específica vale, mostra o aviso azul "confira a edição".'
                : 'Alerta quando ALGUMA impressão vale o mínimo — dispara bem mais, inclusive para cartas baratas que têm um promo caro.'}
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={alertSettings.includeFoil}
                onChange={(e) => updateAlertSettings({ includeFoil: e.target.checked })}
              />
              Considerar versões foil no preço máximo
            </label>
            {alertSettings.basis === 'safe' && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={alertSettings.checkCue}
                  onChange={(e) => updateAlertSettings({ checkCue: e.target.checked })}
                />
                Aviso azul "confira a edição"
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={soundOn} onChange={(e) => changeSound(e.target.checked)} />
              Som
            </label>
            <div className="row">
              Testar:
              <button className="small" onClick={() => testAlert('check')}>Azul</button>
              <button className="small" onClick={() => testAlert('yellow')}>Amarelo</button>
              <button className="small" onClick={() => testAlert('red')}>Vermelho</button>
            </div>
          </div>
        </details>

        <details>
          <summary>Ajustes e diagnóstico</summary>
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

        </details>

        {dataWarning && <div className="error">{dataWarning}</div>}
        <footer className="status">
          <span>
            Preços: {dataStatus}
            {rate && ` · US$ 1 = ${formatPrice(1, rate)} (${rate.source})`} · OCR: {ocrStatus}
            {wakeInfo && ` · ${wakeInfo}`}
          </span>
          <button className="small" onClick={() => loadData(true)} disabled={updating}>
            {updating ? 'Atualizando…' : 'Atualizar preços'}
          </button>
        </footer>
      </section>
    </div>
  );
}
