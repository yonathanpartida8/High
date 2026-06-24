/**
 * src/gestures.js
 * Detección matemática de gestos a partir de los landmarks normalizados de
 * MediaPipe (coordenadas en [0, 1] respecto al frame de video).
 *
 * Índices de landmarks relevantes:
 *   0  -> muñeca (wrist)
 *   4  -> yema del pulgar (thumb tip)
 *   8  -> yema del índice (index tip)
 *   9  -> base del dedo medio (centro aproximado de la palma)
 */

/** Distancia euclidiana entre dos landmarks {x, y}. */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Centroide (promedio) de todos los landmarks de una mano. */
export function centroid(landmarks) {
  let sx = 0;
  let sy = 0;
  for (const p of landmarks) {
    sx += p.x;
    sy += p.y;
  }
  const n = landmarks.length || 1;
  return { x: sx / n, y: sy / n };
}

/**
 * Detector de "swipe" horizontal con debounce/cooldown.
 *
 * Acumula muestras del centroide y, cuando la ventana está llena, calcula la
 * velocidad horizontal (en unidades normalizadas por segundo). Si supera el
 * umbral y el movimiento es predominantemente horizontal, dispara una dirección.
 */
export class SwipeDetector {
  /**
   * @param {{ cooldown?: number, minSpeed?: number, history?: number, horizRatio?: number }} opts
   *  - cooldown: ms entre disparos (1–2 s recomendado).
   *  - minSpeed: velocidad mínima (anchuras de frame por segundo).
   *  - history: nº de muestras en la ventana.
   *  - horizRatio: |dx| debe superar |dy| * horizRatio para considerarse horizontal.
   */
  constructor({ cooldown = 1500, minSpeed = 1.4, history = 6, horizRatio = 1.4 } = {}) {
    this.cooldown = cooldown;
    this.minSpeed = minSpeed;
    this.history = history;
    this.horizRatio = horizRatio;
    /** @type {{x:number, y:number, t:number}[]} */
    this.samples = [];
    this.lastFire = 0;
  }

  reset() {
    this.samples.length = 0;
  }

  /**
   * Alimenta una nueva posición del centroide.
   * @param {{x:number,y:number}|null} point  null si no hay mano (resetea la ventana).
   * @param {number} now  timestamp en ms (performance.now()).
   * @returns {'left'|'right'|null}
   */
  update(point, now) {
    if (!point) {
      this.samples.length = 0;
      return null;
    }

    this.samples.push({ x: point.x, y: point.y, t: now });
    if (this.samples.length > this.history) this.samples.shift();
    if (this.samples.length < this.history) return null;

    // Debounce: respeta el cooldown entre disparos.
    if (now - this.lastFire < this.cooldown) return null;

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return null;

    const dx = last.x - first.x;
    const dy = last.y - first.y;

    // Debe ser un movimiento mayormente horizontal.
    if (Math.abs(dx) < Math.abs(dy) * this.horizRatio) return null;

    const vx = dx / dt; // unidades de frame por segundo
    if (Math.abs(vx) < this.minSpeed) return null;

    this.lastFire = now;
    this.samples.length = 0; // evita re-disparo con la misma trayectoria
    return vx > 0 ? 'right' : 'left';
  }
}

/**
 * Gesto 2: "Cuadro fotográfico" con ambas manos.
 *
 * Cada mano forma una "L" con pulgar (4) e índice (8). Cuando las dos manos se
 * enfrentan en esquinas opuestas, las cuatro yemas delimitan un rectángulo.
 * Devuelve el rectángulo normalizado {x, y, width, height} o null.
 *
 * @param {Array<Array<{x:number,y:number}>>|undefined} multiHandLandmarks
 */
export function detectFrameRect(multiHandLandmarks) {
  if (!multiHandLandmarks || multiHandLandmarks.length < 2) return null;

  const [handA, handB] = multiHandLandmarks;
  const aThumb = handA[4];
  const aIndex = handA[8];
  const bThumb = handB[4];
  const bIndex = handB[8];

  // Cada mano debe tener una apertura mínima pulgar–índice (forma de "L").
  const aSpan = dist(aThumb, aIndex);
  const bSpan = dist(bThumb, bIndex);
  if (aSpan < 0.06 || bSpan < 0.06) return null;

  // Las manos deben estar separadas horizontalmente (esquinas opuestas).
  const aCenterX = (aThumb.x + aIndex.x) / 2;
  const bCenterX = (bThumb.x + bIndex.x) / 2;
  if (Math.abs(aCenterX - bCenterX) < 0.1) return null;

  // Caja delimitadora de las cuatro yemas.
  const xs = [aThumb.x, aIndex.x, bThumb.x, bIndex.x];
  const ys = [aThumb.y, aIndex.y, bThumb.y, bIndex.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const width = maxX - minX;
  const height = maxY - minY;

  // Descarta marcos demasiado pequeños (ruido / manos cerradas).
  if (width < 0.12 || height < 0.12) return null;

  return { x: minX, y: minY, width, height };
}
