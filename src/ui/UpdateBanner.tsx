import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Registra o service worker (o "guardião" que deixa o app funcionar offline) e
 * avisa quando há uma versão nova publicada. A nova versão só entra quando o
 * usuário tocar em "Atualizar" — assim nada muda no meio de uma sessão.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Procura versão nova a cada hora enquanto o app estiver aberto.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (needRefresh) {
    return (
      <div className="banner">
        Nova versão disponível.
        <button className="small primary" onClick={() => void updateServiceWorker(true)}>
          Atualizar
        </button>
        <button className="small" onClick={() => setNeedRefresh(false)}>
          Depois
        </button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div className="banner">
        Pronto para usar sem internet.
        <button className="small" onClick={() => setOfflineReady(false)}>
          OK
        </button>
      </div>
    );
  }
  return null;
}
