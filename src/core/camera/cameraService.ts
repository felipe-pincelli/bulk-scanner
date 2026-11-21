/**
 * Acesso à câmera (getUserMedia). Não depende de React.
 */

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export async function listCameras(): Promise<CameraDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${i + 1}` }));
}

/**
 * Abre a câmera e liga ao <video>.
 * Sem deviceId: pede a câmera traseira (no iPhone) — no PC o navegador usa a padrão.
 */
export async function startCamera(video: HTMLVideoElement, deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador não permite acesso à câmera. No iPhone, use o Safari e um endereço https://.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: 'environment' } }),
      // Resolução maior = letras mais nítidas no recorte do nome.
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  // Necessários no iPhone para o vídeo tocar dentro da página (e não em tela cheia).
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
