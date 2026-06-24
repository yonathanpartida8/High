import { Camera } from '@mediapipe/camera_utils';

/**
 * src/camera.js
 * Inicialización de la cámara, control de resoluciones y manejo de permisos.
 *
 * Usamos `@mediapipe/camera_utils` (Camera) como bomba de frames hacia MediaPipe:
 * llama a `onFrame` en cada cuadro disponible. La adquisición de la cámara ocurre
 * una sola vez (sin "doble apertura"), y los errores de `getUserMedia` se propagan
 * a través de `camera.start()`, lo que nos permite construir un modal elegante.
 */

/** Error tipado para que la UI muestre el mensaje/instrucciones correctos. */
export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}

/** Traduce un DOMException de getUserMedia a un CameraError con código estable. */
function classify(err) {
  if (err instanceof CameraError) return err;
  if (!window.isSecureContext) {
    return new CameraError(
      'insecure',
      'El acceso a la cámara requiere un contexto seguro (HTTPS).'
    );
  }
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError('denied', 'Permiso de cámara denegado.');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('notfound', 'No se detectó ninguna cámara en el dispositivo.');
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError('inuse', 'La cámara está siendo usada por otra aplicación.');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraError('overconstrained', 'La resolución solicitada no está disponible.');
    default:
      return new CameraError('unknown', err?.message || 'Error desconocido al iniciar la cámara.');
  }
}

// Resoluciones a intentar, de mayor a menor (degradación elegante).
const RESOLUTIONS = [
  { width: 1280, height: 720 },
  { width: 960, height: 540 },
  { width: 640, height: 480 },
];

/**
 * Crea el controlador de cámara.
 * @param {HTMLVideoElement} video
 * @param {{ onFrame: () => (void|Promise<void>) }} opts
 */
export function createCameraController(video, { onFrame } = {}) {
  let camera = null;
  let facingMode = 'environment'; // prioriza cámara trasera

  async function startWith(mode) {
    let lastErr = null;
    for (const res of RESOLUTIONS) {
      try {
        camera = new Camera(video, {
          onFrame,
          facingMode: mode,
          width: res.width,
          height: res.height,
        });
        await camera.start();
        facingMode = mode;
        return;
      } catch (err) {
        lastErr = err;
        try { await camera?.stop?.(); } catch (_) { /* noop */ }
        camera = null;
        const classified = classify(err);
        // Sólo tiene sentido reintentar con menor resolución si fue "overconstrained".
        if (classified.code !== 'overconstrained') throw classified;
      }
    }
    throw classify(lastErr);
  }

  return {
    /** Inicia la cámara con la orientación preferida actual. */
    start() {
      return startWith(facingMode);
    },

    /** Detiene la captura y libera el stream. */
    async stop() {
      try { await camera?.stop?.(); } catch (_) { /* noop */ }
      camera = null;
    },

    /** Alterna entre cámara trasera ('environment') y frontal ('user'). */
    async switchCamera() {
      const next = facingMode === 'environment' ? 'user' : 'environment';
      try { await camera?.stop?.(); } catch (_) { /* noop */ }
      camera = null;
      await startWith(next);
      return facingMode;
    },

    /** Orientación de cámara activa. */
    get facingMode() {
      return facingMode;
    },
  };
}
