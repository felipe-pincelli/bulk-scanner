/**
 * Mantém a tela ligada durante a sessão (Screen Wake Lock API).
 * O navegador solta a trava quando a aba fica em segundo plano; ao voltar,
 * pedimos de novo. Devolve uma função para liberar.
 * Suportado no Chrome/Edge e no Safari do iPhone (iOS 16.4+).
 */
export async function keepScreenOn(): Promise<{ supported: boolean; release: () => void }> {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
    .wakeLock;
  if (!wl) return { supported: false, release: () => {} };

  let sentinel: { release(): Promise<void> } | null = null;
  let active = true;
  const acquire = async () => {
    try {
      sentinel = await wl.request('screen');
    } catch {
      /* negado (ex.: modo economia de bateria) */
    }
  };
  const onVisible = () => {
    if (active && document.visibilityState === 'visible') void acquire();
  };
  await acquire();
  document.addEventListener('visibilitychange', onVisible);
  return {
    supported: true,
    release: () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release();
    },
  };
}
