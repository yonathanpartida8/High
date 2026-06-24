import { HAND_CONNECTIONS } from './vision.js';

/**
 * src/filters.js
 * Utilidades de render y catálogo de filtros AR.
 *
 * Convención de coordenadas: el render trabaja en PÍXELES DE DISPOSITIVO del
 * canvas (w = canvas.width, h = canvas.height). Los landmarks vienen en [0,1]
 * relativos al frame de video y se transforman con `makeMapper`, que replica
 * exactamente el encuadre "cover" usado por `drawVideoCover`.
 */

/* ----------------------------- Utilidades ------------------------------ */

/**
 * Dibuja el video cubriendo todo el canvas (object-fit: cover).
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLVideoElement} video
 * @param {number} w  @param {number} h
 * @param {{ mirror?: boolean, filter?: string }} [opts]
 */
export function drawVideoCover(ctx, video, w, h, { mirror = false, filter = 'none' } = {}) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  ctx.save();
  if (filter && filter !== 'none') ctx.filter = filter;
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Crea un mapeador landmark-normalizado -> píxel de canvas, coherente con el
 * encuadre "cover" (y con el espejado si la cámara es frontal).
 */
export function makeMapper(video, w, h, mirror = false) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;

  return (nx, ny) => {
    const px = dx + nx * dw;
    return { x: mirror ? w - px : px, y: dy + ny * dh };
  };
}

/** Dibuja un esqueleto de mano con brillo neón (composición aditiva). */
function drawGlowSkeleton(ctx, landmarks, map, hue, w) {
  const line = Math.max(2, w * 0.006);
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = line;
  ctx.strokeStyle = `hsl(${hue}, 100%, 62%)`;
  ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
  ctx.shadowBlur = w * 0.02;

  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    const p = map(landmarks[a].x, landmarks[a].y);
    const q = map(landmarks[b].x, landmarks[b].y);
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }
  ctx.stroke();

  // Articulaciones
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const r = w * 0.006;
  for (const k of landmarks) {
    const p = map(k.x, k.y);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Esqueleto tenue (para el filtro "Original": feedback de tracking). */
function drawSubtleSkeleton(ctx, results, map, w) {
  if (!results?.multiHandLandmarks) return;
  ctx.save();
  ctx.lineWidth = Math.max(1.5, w * 0.0035);
  ctx.strokeStyle = 'rgba(52, 224, 255, 0.55)';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const lm of results.multiHandLandmarks) {
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const p = map(lm[a].x, lm[a].y);
      const q = map(lm[b].x, lm[b].y);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    const r = w * 0.004;
    for (const k of lm) {
      const p = map(k.x, k.y);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/* ------------------------------ Filtros -------------------------------- */

/** Filtro 0: vídeo limpio + esqueleto tenue. */
function createOriginalFilter() {
  return {
    id: 'original',
    name: 'Original',
    icon: '🎥',
    draw(ctx, f) {
      drawVideoCover(ctx, f.video, f.w, f.h, { mirror: f.mirror });
      drawSubtleSkeleton(ctx, f.results, f.map, f.w);
    },
  };
}

/**
 * Filtro 1: "Letras AR" (Matrix / Cyber).
 * Lluvia de caracteres que se superpone con globalCompositeOperation='screen'
 * y reacciona acelerando cerca de las manos.
 */
function createMatrixFilter() {
  const CHARS = 'アイウエオカキクケコｱｲｳｴｵ0123456789ABCDEFﾊﾋﾌﾍﾎ<>=*+';
  const st = { w: 0, h: 0, font: 0, cols: 0, drops: [], speeds: [] };

  function ensure(w, h) {
    const font = Math.max(14, Math.round(h / 42));
    if (st.w === w && st.h === h && st.font === font) return;
    st.w = w;
    st.h = h;
    st.font = font;
    st.cols = Math.ceil(w / font);
    st.drops = Array.from({ length: st.cols }, () => Math.random() * -h);
    st.speeds = Array.from({ length: st.cols }, () => font * (0.25 + Math.random() * 0.55));
  }

  return {
    id: 'matrix',
    name: 'Letras AR',
    icon: '🟩',
    draw(ctx, f) {
      const { w, h, video, dt, handPoints } = f;
      ensure(w, h);

      // Base de video oscurecida para resaltar las letras.
      drawVideoCover(ctx, video, w, h, {
        mirror: f.mirror,
        filter: 'brightness(0.55) saturate(1.15) contrast(1.05)',
      });

      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.font = `${st.font}px monospace`;
      ctx.textBaseline = 'top';

      const step = Math.min(dt, 50) / 16.67; // normaliza a ~60 fps

      for (let i = 0; i < st.cols; i++) {
        const x = i * st.font;

        // Aceleración reactiva: columnas cercanas a una mano caen más rápido.
        let boost = 1;
        for (const p of handPoints) {
          const d = Math.abs(p.x - x);
          const radius = st.font * 4;
          if (d < radius) boost = Math.max(boost, 2.4 - d / radius);
        }

        st.drops[i] += st.speeds[i] * boost * step;
        if (st.drops[i] > h + st.font) st.drops[i] = Math.random() * -h * 0.5;

        const y = st.drops[i];
        // Estela de caracteres con desvanecimiento.
        for (let t = 0; t < 7; t++) {
          const yy = y - t * st.font;
          if (yy < -st.font || yy > h) continue;
          const c = CHARS[(Math.floor(yy / st.font) + i) % CHARS.length];
          if (t === 0) {
            ctx.fillStyle = 'rgba(215,255,225,0.95)'; // cabeza brillante
          } else {
            ctx.fillStyle = `rgba(0,255,120,${Math.max(0, 0.55 - t * 0.08)})`;
          }
          ctx.fillText(c, x, yy);
        }
      }
      ctx.restore();
    },
  };
}

/** Filtro 2: "Neón" — esqueleto luminoso aditivo sobre vídeo apagado. */
function createNeonFilter() {
  return {
    id: 'neon',
    name: 'Neón',
    icon: '💠',
    draw(ctx, f) {
      drawVideoCover(ctx, f.video, f.w, f.h, {
        mirror: f.mirror,
        filter: 'saturate(0.5) brightness(0.78) contrast(1.12)',
      });
      const lms = f.results?.multiHandLandmarks;
      if (!lms) return;
      lms.forEach((lm, idx) => {
        const hue = (f.time * 0.06 + idx * 140) % 360;
        drawGlowSkeleton(ctx, lm, f.map, hue, f.w);
      });
    },
  };
}

/** Filtro 3: "Térmico" — falso mapa de calor con filtros nativos (iOS-safe). */
function createThermalFilter() {
  return {
    id: 'thermal',
    name: 'Térmico',
    icon: '🔥',
    draw(ctx, f) {
      const hue = 150 + Math.sin(f.time * 0.0006) * 20; // leve "barrido"
      drawVideoCover(ctx, f.video, f.w, f.h, {
        mirror: f.mirror,
        filter: `sepia(1) saturate(3.2) hue-rotate(${hue}deg) contrast(1.35) brightness(1.08)`,
      });
    },
  };
}

/** Filtro 4: "Pop Art" — alto contraste y saturación estilo cómic. */
function createPopFilter() {
  return {
    id: 'pop',
    name: 'Pop Art',
    icon: '🎨',
    draw(ctx, f) {
      drawVideoCover(ctx, f.video, f.w, f.h, {
        mirror: f.mirror,
        filter: 'contrast(1.7) saturate(2.1) brightness(1.05) sepia(0.15)',
      });
    },
  };
}

/** Catálogo ordenado de filtros (el orden define el ciclo del swipe). */
export const FILTERS = [
  createOriginalFilter(),
  createMatrixFilter(),
  createNeonFilter(),
  createThermalFilter(),
  createPopFilter(),
];
