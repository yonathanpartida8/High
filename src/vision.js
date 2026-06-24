import { Hands, HAND_CONNECTIONS } from '@mediapipe/hands';

/**
 * src/vision.js
 * Configuración de MediaPipe Hands.
 *
 * El paquete npm `@mediapipe/hands` aporta el wrapper JS, pero los binarios
 * (.wasm / .data / .tflite) se cargan vía `locateFile`. Apuntamos a un CDN
 * fijado EXACTAMENTE a la versión instalada para garantizar compatibilidad
 * entre el JS y los binarios, y evitar problemas de rutas en GitHub Pages.
 */

const HANDS_VERSION = '0.4.1675469240';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/hands@${HANDS_VERSION}`;

// Re-exportamos las conexiones del esqueleto para que el render las use.
export { HAND_CONNECTIONS };

/**
 * Crea el tracker de manos.
 * @param {{
 *   onResults?: (results: any) => void,
 *   maxNumHands?: number,
 *   modelComplexity?: 0 | 1,
 *   selfieMode?: boolean,
 * }} opts
 */
export function createHandTracker({
  onResults,
  maxNumHands = 2, // obligatorio: hasta 2 manos
  modelComplexity = 1,
  selfieMode = false,
} = {}) {
  const hands = new Hands({
    locateFile: (file) => `${CDN}/${file}`,
  });

  hands.setOptions({
    maxNumHands,
    modelComplexity,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
    selfieMode,
  });

  if (typeof onResults === 'function') {
    hands.onResults(onResults);
  }

  return {
    /** Envía un frame (HTMLVideoElement/Canvas/Image) al modelo. Devuelve Promise. */
    send: (image) => hands.send({ image }),
    /** Actualiza opciones en caliente (p. ej. selfieMode al cambiar de cámara). */
    setOptions: (options) => hands.setOptions(options),
    /** Libera recursos del modelo. */
    close: () => hands.close(),
  };
}
