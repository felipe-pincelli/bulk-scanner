import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listCameras, startCamera, stopCamera, type CameraDevice } from '../core/camera/cameraService';
import { screenRectToVideoRect } from '../core/camera/geometry';
import { gameList, games } from '../core/games/registry';
import type { GameProvider, PriceInfo } from '../core/games/types';
import { FuzzyMatcher } from '../core/matching/fuzzyMatcher';
import { loadCardIndex } from '../core/prices/cardDatabase';
import { formatPrice, getUsdBrl, type Rate } from '../core/prices/currency';
import { TesseractEngine } from '../core/ocr/tesseractEngine';
import { orientationLabel } from '../core/scanner/orientation';
import { Scanner, type ScanRead } from '../core/scanner/scanner';
import { evaluateAlert, type AlertBasis, type AlertLevel, type AlertSettings } from '../core/alerts/alertRules';
import { AlertFlow } from '../core/alerts/alertFlow';
import { priceForPrintings } from '../core/edition/editionPrice';
import { buildFooterIndex, type FooterIndex } from '../core/edition/footerIndex';
import { adjustPrice, CONDITION_NAME, CONDITIONS, FINISHES, type Condition, type CopyInfo, type Finish } from '../core/prices/copyPrice';
import type { EditionResult } from '../core/edition/parseFooter';
import { createWebFeedback } from '../core/platform/feedback';
import { keepScreenOn } from '../core/platform/wakeLock';
import { loadPref, savePref } from '../core/settings/settings';
import {
  addEntry,
  loadSession,
  newSession,
  removeEntry,
  replaceLastEntry,
  saveSession,
  setEntryCondition,
  setEntryFinish,
  type Session,
} from '../core/session/session';
import { SessionSummaryView } from './SessionSummary';
import { UpdateBanner } from './UpdateBanner';

/**
 * Etapa 3: leitura contínua + preço em R$ + alertas (som + flash) com cooldown.
 * Toda a lógica fica em src/core; aqui é só a tela.
 */

const BASE = import.meta.env.BASE_URL;
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


/** O texto lido é outro nome (ex.: em português), e não só uma face de "A // B"? */
function isOtherName(readAs: string, cardName: string) {
  return readAs !== cardName && !cardName.split(' // ').includes(readAs);
}

interface EditionView {
  cardName: string;
  result: EditionResult | null;
  done: boolean;
  rawText: string;
}

/** Linha "Edição: …" com o que foi lido no rodapé da carta. */
function EditionLine({ view, hasPrintings }: { view: EditionView | null; hasPrintings: boolean }) {
  if (!hasPrintings) return null;
  const r = view?.result;
  if (r?.printing) {
    return (
      <div className="edition ok">
        Edição: <b>{r.printing.setName}</b> ({r.printing.set.toUpperCase()}) · nº {r.printing.number}
      </div>
    );
  }
  if (r?.set) {
    return (
      <div className="edition ok">
        Edição: <b>{r.candidates[0]?.setName}</b> ({r.set.toUpperCase()}) · {r.candidates.length} versões
      </div>
    );
  }
  if (!view) return null;
  return <div className="edition muted">{view.done ? 'Edição não identificada' : 'Lendo edição…'}</div>;
}

function PriceLine({ info, rate, game }: { info: PriceInfo | undefined; rate: Rate | null; game: GameProvider }) {
  if (!info || info.maxUsd === null) return <div className="price none">sem preço no Scryfall</div>;
  const showNonfoil = info.maxNonfoilUsd !== null && info.maxNonfoilUsd !== info.maxUsd;
  return (
    <div className="price">
      <span className="range">
        {info.minUsd === info.maxUsd ? formatPrice(info.maxUsd, rate) : `${formatPrice(info.minUsd, rate)} – ${formatPrice(info.maxUsd, rate)}`}
      </span>
      <span className="detail">
        mais cara: {info.maxSetName} ({game.finishLabels[info.maxFinish]})
        {showNonfoil && ` · ${game.finishLabels.nonfoil} até ${formatPrice(info.maxNonfoilUsd, rate)}`}
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
  const footerPreviewRef = useRef<HTMLCanvasElement>(null);
  const copyRef = useRef<CopyInfo>({});
  const footerIndexRef = useRef<FooterIndex | null>(null);
  const lotLangRef = useRef<NonNullable<GameProvider['lotLanguages']>[number] | null>(null);
  /** Último texto reconhecido de cada carta (ex.: "Relâmpago" → Lightning Bolt). */
  const readNameRef = useRef(new Map<string, string>());
  const flowRef = useRef<AlertFlow | null>(null);
  if (!flowRef.current) {
    flowRef.current = new AlertFlow({
      getPrice: (name) => pricesRef.current.get(name),
      getRate: () => rateRef.current?.usdBrl ?? null,
      getSettings: () => alertRef.current,
      getCopy: () => copyRef.current,
    });
  }
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
  // Jogo escolhido (salvo no aparelho). Só um jogo por vez: dados, nomes e sessão dele.
  const [gameId, setGameId] = useState(() => {
    const saved = loadPref('game', 'magic');
    return games[saved] ? saved : 'magic';
  });
  const game = games[gameId];
  const gameRef = useRef(game);
  gameRef.current = game;
  // Idioma das próximas cartas (Magic): japonês, phyrexiano… → identificação pelo rodapé.
  const [lotLangId, setLotLangId] = useState(() => loadPref('lotLang', 'latin'));
  const lotLang = game.lotLanguages?.find((l) => l.id === lotLangId) ?? null;
  lotLangRef.current = lotLang;
  const sessionGameRef = useRef<string | null>(null);
  const [session, setSession] = useState<Session>(newSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [showSummary, setShowSummary] = useState(false);
  const sessionLoaded = useRef(false);
  const [alertSettings, setAlertSettings] = useState<AlertSettings>(alertRef.current);
  const [minInput, setMinInput] = useState(String(alertRef.current.minBrl));
  const [soundOn, setSoundOn] = useState(() => loadPref('sound', '1') === '1');
  // Lote: acabamento/condição de TODAS as próximas cartas (quem já separou antes).
  const [copy, setCopy] = useState<CopyInfo>(() => ({
    finish: (FINISHES as string[]).includes(loadPref('lotFinish', '')) ? (loadPref('lotFinish', '') as Finish) : undefined,
    condition: (CONDITIONS as string[]).includes(loadPref('lotCondition', ''))
      ? (loadPref('lotCondition', '') as Condition)
      : undefined,
  }));
  copyRef.current = copy;
  // Catálogo edição+número → carta: só é montado quando o lote usa um idioma
  // reconhecido pelo rodapé (japonês, phyrexiano…).
  const footerIndex = useMemo(
    () => ((lotLang?.footerOnly || lotLang?.footerFallback) && prices.size ? buildFooterIndex(prices) : null),
    [prices, lotLang?.footerOnly, lotLang?.footerFallback],
  );
  footerIndexRef.current = footerIndex;

  function changeCopy(patch: CopyInfo) {
    const next = { ...copyRef.current, ...patch };
    copyRef.current = next;
    setCopy(next);
    savePref('lotFinish', next.finish ?? '');
    savePref('lotCondition', next.condition ?? '');
  }
  const [flash, setFlash] = useState<{ level: AlertLevel; id: number } | null>(null);
  const [editionView, setEditionView] = useState<EditionView | null>(null);
  const [wakeInfo, setWakeInfo] = useState<string>('');

  useEffect(() => feedback.setSoundEnabled(soundOn), [soundOn]);
  // Sessão salva no aparelho (uma por jogo): recupera ao abrir/trocar de jogo e
  // salva a cada mudança.
  useEffect(() => {
    sessionLoaded.current = false;
    sessionGameRef.current = null;
    setSession(newSession());
    void loadSession(gameId).then((s) => {
      setSession(s);
      sessionGameRef.current = gameId;
      sessionLoaded.current = true;
    });
  }, [gameId]);
  useEffect(() => {
    if (sessionLoaded.current && sessionGameRef.current) void saveSession(sessionGameRef.current, session);
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
    const g = gameRef.current;
    try {
      const { index, warning } = await loadCardIndex(g, BASE, force);
      if (gameRef.current !== g) return; // trocou de jogo enquanto carregava
      const m = new FuzzyMatcher(index.entries);
      matcherRef.current = m;
      scannerRef.current?.setMatcher(m);
      setPrices(index.prices);
      setDataWarning(warning ?? null);
      const date = new Date(index.pricesUpdatedAt).toLocaleDateString('pt-BR');
      setDataStatus(`${index.prices.size.toLocaleString('pt-BR')} cartas · preços de ${date}`);
      setRate(await getUsdBrl({ usdBrl: index.usdBrl, at: index.builtAt }, force));
    } catch (e) {
      if (gameRef.current !== g) return;
      matcherRef.current = null;
      scannerRef.current?.setMatcher(null);
      setPrices(new Map());
      setDataStatus('indisponível');
      setDataWarning((e as Error).message);
    } finally {
      setUpdating(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData, gameId]);

  function changeGame(id: string) {
    if (running || id === gameId) return;
    savePref('game', id);
    const g = games[id];
    gameRef.current = g;
    setGameId(id);
    setRead(null);
    setEditionView(null);
    setDataStatus('carregando…');
    setDataWarning(null);
    matcherRef.current = null;
    scannerRef.current?.setGame(g);
    scannerRef.current?.setMatcher(null);
    void engineRef.current?.setNameWhitelist(g.nameCharWhitelist);
    flowRef.current!.reset();
  }

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

    // Leitura do rodapé (edição): guarda o melhor resultado da carta atual.
    if (r.edition) {
      const e = r.edition;
      setEditionView((prev) => {
        const fresh = !prev || prev.cardName !== e.cardName || e.attempts === 1;
        const best = fresh ? null : prev.result;
        const better = e.result && (e.result.printing || (e.result.set && !best?.printing)) ? e.result : best;
        return { cardName: e.cardName, result: better, done: e.done, rawText: e.rawText };
      });
      const fp = footerPreviewRef.current;
      if (fp && e.crop) {
        fp.width = e.crop.width;
        fp.height = e.crop.height;
        fp.getContext('2d')!.drawImage(e.crop, 0, 0);
      }
    }

    if (r.match) readNameRef.current.set(r.match.cardName, r.match.matchText);

    // Cartas "fechadas" nesta leitura: alerta (uma vez por carta) e entra na sessão.
    const severity = { none: 0, check: 1, yellow: 2, red: 3 } as const;
    // Correção que chega junto com o alerta original (mesma leitura): vira um só.
    const events = flowRef.current!.onRead(r);
    const batch: typeof events = [];
    for (const ev of events) {
      const i = ev.replaces ? batch.findIndex((b) => b.cardName === ev.cardName && !b.replaces) : -1;
      if (i >= 0) batch[i] = { ...ev, replaces: false };
      else batch.push(ev);
    }
    for (const ev of batch) {
      const usdBrl = rateRef.current?.usdBrl ?? null;
      const data = { cardName: ev.cardName, ...ev.decision, price: ev.price, usdBrl, printing: ev.printing, set: ev.set };
      const lot = {
        finish: copyRef.current.finish,
        condition: copyRef.current.condition,
        lang: lotLangRef.current && lotLangRef.current.id !== 'latin' ? lotLangRef.current.label : undefined,
      };
      const readAs = readNameRef.current.get(ev.cardName);
      const printedName = readAs && isOtherName(readAs, ev.cardName) ? readAs : undefined;
      if (ev.replaces) {
        // Edição lida depois do alerta: corrige a sessão; se subiu de nível, avisa de novo.
        const prev = [...sessionRef.current.entries].reverse().find((e) => e.cardName === ev.cardName);
        if (prev && severity[ev.decision.level] > severity[prev.level]) {
          feedback.alert(ev.decision.level);
          setFlash({ level: ev.decision.level, id: performance.now() });
        }
        setSession((s) => replaceLastEntry(s, data));
        continue;
      }
      if (ev.decision.level !== 'none') {
        feedback.alert(ev.decision.level);
        setFlash({ level: ev.decision.level, id: performance.now() });
      }
      setSession((s) => addEntry(s, { ...data, ...lot, printedName, at: Date.now() }));
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
        const engine = new TesseractEngine(`${BASE}tesseract/`, gameRef.current.nameCharWhitelist);
        setOcrStatus('carregando…');
        await engine.init((msg) => setOcrStatus(msg));
        engineRef.current = engine;
        setOcrStatus('pronto');
      }
      // Idioma do leitor de nomes conforme o lote (ex.: japonês).
      const ocrLang = lotLangRef.current?.ocrLang ?? 'eng';
      if (engineRef.current.setNameLanguage) {
        if (ocrLang !== 'eng') setOcrStatus('carregando japonês…');
        await engineRef.current.setNameLanguage(ocrLang, gameRef.current.nameCharWhitelist);
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
          game: gameRef.current,
          getZoneRect,
          onRead,
          autoRotate,
          needsEdition: (name) => flowRef.current!.needsEdition(name),
          getFooterIndex: () => (lotLangRef.current?.footerOnly ? footerIndexRef.current : null),
          getFooterFallback: () => (lotLangRef.current?.footerFallback ? footerIndexRef.current : null),
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
    flowRef.current!.reset();
    setEditionView(null);
  }

  function stop() {
    scannerRef.current?.stop();
    stopCamera(streamRef.current);
    streamRef.current = null;
    releaseWakeRef.current?.();
    releaseWakeRef.current = null;
    flowRef.current!.reset();
    setEditionView(null);
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

  const status = read?.match
    ? read.confirmed
      ? 'confirmed'
      : 'tentative'
    : 'none';
  // Preço da carta na tela: da edição identificada no rodapé, se houver.
  const ed = read?.match && editionView?.cardName === read.match.cardName ? editionView : null;
  const edPrice = ed?.result?.printing
    ? priceForPrintings([ed.result.printing])
    : ed?.result?.set
      ? priceForPrintings(ed.result.candidates)
      : null;
  const basePrice = read?.match ? (edPrice ?? prices.get(read.match.cardName)) : undefined;
  // Com lote informado (ex.: "foil · SP"), mostra o preço dessa cópia.
  const shownPrice =
    basePrice && (copy.finish || copy.condition) ? adjustPrice(basePrice, copy, ed?.result?.printing) : basePrice;
  const lotLabel = [
    lotLang && lotLang.id !== 'latin' && lotLang.label,
    copy.finish && game.finishLabels[copy.finish],
    copy.condition,
  ]
    .filter(Boolean)
    .join(' · ');
  const current = read?.match ? evaluateAlert(shownPrice, rate?.usdBrl ?? null, alertSettings) : null;
  const history = [...session.entries].reverse();
  const alertCount = history.filter((h) => h.level === 'yellow' || h.level === 'red').length;

  return (
    <div className="app">
      <header className="topbar">
        <strong>Bulk Scanner</strong>
        <span className="tag">beta</span>
        <div className="spacer" />
        <select
          value={gameId}
          onChange={(e) => changeGame(e.target.value)}
          disabled={running || busy}
          aria-label="Jogo"
          title={running ? 'Pare a sessão para trocar de jogo' : 'Escolha o jogo'}
        >
          {gameList.map((g) => (
            <option key={g.id} value={g.id}>
              {g.shortName}
            </option>
          ))}
        </select>
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
        <div ref={zoneRef} className={`zone ${status}`} style={{ '--g': zoneSize } as React.CSSProperties}>
          <div className="card-ghost" style={{ '--aspect': game.cardAspect } as React.CSSProperties} />
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
        </div>
        {lotLabel && <div className="lot-badge">Lote: {lotLabel}</div>}
        {!running && !busy && (
          <div className="hint">
            Jogo: <b>{game.displayName}</b> (troque no topo). Toque em <b>Iniciar sessão</b> (libera o som) e
            coloque a carta dentro do quadrado — em pé ou deitada.
          </div>
        )}
      </div>

      <UpdateBanner />
      {showSummary && (
        <SessionSummaryView
          game={game}
          session={session}
          minBrl={alertSettings.minBrl}
          onRemove={(id) => setSession((s) => removeEntry(s, id))}
          onFinish={(id, f) => setSession((s) => setEntryFinish(s, id, f))}
          onCondition={(id, c) => setSession((s) => setEntryCondition(s, id, c))}
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
            <span className={`badge ${current.level}`}>
              {current.level === 'check' && ed?.result?.printing
                ? `confira se é ${game.finishLabels.foil}`
                : levelLabel[current.level]}
            </span>
          )}
        </div>
        {read?.match && isOtherName(read.match.matchText, read.match.cardName) && (
          <div className="muted small">lido como: {read.match.matchText}</div>
        )}
        {read?.match && <EditionLine view={ed} hasPrintings={(prices.get(read.match.cardName)?.printings?.length ?? 0) > 1} />}
        {read?.match && <PriceLine info={shownPrice} rate={rate} game={game} />}
        {read?.match && lotLabel && <div className="muted small">preço considerando o lote: {lotLabel}</div>}

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

        <details className="lot">
          <summary className="lot-title">
            Próximas cartas: <b>{lotLabel || 'não informado'}</b>{' '}
            <span className="muted small">(vale para todas até você mudar)</span>
          </summary>
          {game.lotLanguages && (
            <div className="chips" role="group" aria-label="Idioma das próximas cartas">
              <span className="lot-label">Idioma</span>
              {game.lotLanguages.map((l) => (
                <button
                  key={l.id}
                  className={`chip ${lotLang?.id === l.id ? 'on' : ''}`}
                  onClick={() => {
                    setLotLangId(l.id);
                    savePref('lotLang', l.id);
                    lotLangRef.current = l;
                    // Se a câmera já está rodando, troca o idioma do leitor na hora.
                    void engineRef.current?.setNameLanguage?.(l.ocrLang ?? 'eng', gameRef.current.nameCharWhitelist);
                  }}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
          {lotLang?.footerOnly && (
            <p className="muted small">
              Em {lotLang.label}, a carta é reconhecida pelo <b>rodapé</b> (edição + número, ex.: "ONE • PH 010"):
              funciona com cartas de 2015 em diante. O preço é o da mesma edição/número em inglês.
            </p>
          )}
          {lotLang?.ocrLang && (
            <p className="muted small">
              Em {lotLang.label}, o app lê o <b>nome em {lotLang.label}</b> (cartas antigas também) e, se não
              reconhecer, o <b>rodapé</b> (cartas de 2015 em diante). O preço é o da versão em inglês.
            </p>
          )}
          <div className="chips" role="group" aria-label="Acabamento das próximas cartas">
            <span className="lot-label">Acabamento</span>
            <button className={`chip ${!copy.finish ? 'on' : ''}`} onClick={() => changeCopy({ finish: undefined })}>
              não informado
            </button>
            {FINISHES.map((f) => (
              <button key={f} className={`chip ${copy.finish === f ? 'on' : ''}`} onClick={() => changeCopy({ finish: f })}>
                {game.finishLabels[f]}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Condição das próximas cartas">
            <span className="lot-label">Condição</span>
            <button className={`chip ${!copy.condition ? 'on' : ''}`} onClick={() => changeCopy({ condition: undefined })}>
              não informada
            </button>
            {CONDITIONS.map((c) => (
              <button
                key={c}
                className={`chip ${copy.condition === c ? 'on' : ''}`}
                title={CONDITION_NAME[c]}
                onClick={() => changeCopy({ condition: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </details>

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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={alertSettings.includeFoil}
                onChange={(e) => updateAlertSettings({ includeFoil: e.target.checked })}
              />
              Considerar versões {game.id === 'magic' ? 'foil' : `${game.finishLabels.foil} e ${game.finishLabels.etched}`} no preço máximo
            </label>
            {alertSettings.basis === 'safe' && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={alertSettings.checkCue}
                  onChange={(e) => updateAlertSettings({ checkCue: e.target.checked })}
                />
                Aviso azul "confira a edição"
              </label>
            )}
            <label className="checkbox-row">
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
          <span>Rodapé leu: <code>{editionView?.rawText.replace(/\s+/g, ' ').trim() || '…'}</code></span>
        </div>

        <div className="row">
          <canvas ref={previewRef} className="preview" aria-label="Recorte enviado ao OCR" />
          <canvas ref={footerPreviewRef} className="preview" aria-label="Recorte do rodapé" />
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
          <label className="checkbox-row">
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
