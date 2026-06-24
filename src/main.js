import { createCameraController, CameraError } from './camera.js';
import { createHandTracker } from './vision.js';
import { FILTERS, makeMapper, drawVideoCover } from './filters.js';
import { SwipeDetector, detectFrameRect, centroid } from './gestures.js';

/**
 * src/main.js
 * Controlador principal: sincroniza video y canvas, procesa los gestos y
 * ejecuta el ciclo de render con requestAnimationFrame.
 *
 * Arquitectura de doble bucle (desacopla captura de presentación):
 *   1) camera_utils.Camera -> onFrame -> tracker.send(video)   (entrada de visión)
 *   2) requestAnimationFrame -> render(canvas)                 (presentación fluida)
 */

/* --------------------------- Referencias DOM --------------------------- */
const video = document.getElementById('camera');
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

const elFps = document.getElementById('fps');
const elHands = document.getElementById('hands-count');
const elToast = document.getElementById('toast');
const elChips = document.getElementById('filters');
const elHint = document.getElementById('hint');
const elLoading = document.getElementById('loading');
const elModal = document.getElementById('modal');
const elModalIcon = document.getElementById('modal-icon');
const elModalTitle = document.getElementById('modal-title');
const elModalText = document.getElementById('modal-text');
const elModalSteps = document.getElementById('modal-steps');
const btnRetry = document.getElementById('btn-retry');
const btnSwitch = document.getElementById('btn-switch');
const btnCapture = document.getElementById('btn-capture');

/* ------------------------------- Estado ------------------------------- */
let tracker = null;
let cam = null;
let currentFilter = 0;
let latestResults = null;
let frameRect = null; // rectángulo del "cuadro fotográfico" (normalizado) o null
let mirror = false; // true cuando la cámara es frontal
let rafId = 0;
let lastFrameTime = 0;
let prevCentroid = null;

const swipe = new SwipeDetector({ cooldown: 1500, minSpeed: 1.4 });

// FPS suavizado
let fpsEma = 0;
let lastFpsUpdate = 0;

/* ------------------------------- UI ----------------------------------- */

function buildChips() {
  elChips.innerHTML = '';
  FILTERS.forEach((filter, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (index === currentFilter ? ' active' : '');
    chip.dataset.index = String(index);
    chip.innerHTML = `<span aria-hidden="true">${filter.icon}</span> ${filter.name}`;
    chip.addEventListener('click', () => selectFilter(index));
    elChips.appendChild(chip);
  });
}

function refreshChips() {
  [...elChips.children].forEach((chip, i) => {
    chip.classList.toggle('active', i === currentFilter);
  });
}

let toastTimer = 0;
function toast(message) {
  elToast.textContent = message;
  elToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.remove('show'), 1100);
}

function selectFilter(index) {
  currentFilter = (index + FILTERS.length) % FILTERS.length;
  refreshChips();
  const f = FILTERS[currentFilter];
  toast(`${f.icon} ${f.name}`);
  // Centra el chip activo en la barra desplazable.
  elChips.children[currentFilter]?.scrollIntoView({
    behavior: 'smooth',
    inline: 'center',
    block: 'nearest',
  });
}

function cycleFilter(direction) {
  selectFilter(currentFilter + direction);
}

let hintHidden = false;
function hideHintOnce() {
  if (hintHidden) return;
  hintHidden = true;
  elHint.classList.add('fade');
  setTimeout(() => elHint.remove(), 800);
}

/* --------------------------- Modal de error --------------------------- */

const ERROR_INFO = {
  denied: {
    icon: '🚫',
    title: 'Permiso de cámara denegado',
    text: 'Para usar la AR necesitas habilitar la cámara en tu navegador.',
    steps: [
      'Toca el icono de candado/cámara en la barra de direcciones.',
      'Selecciona "Permitir" para la cámara.',
      'Vuelve aquí y pulsa "Reintentar".',
    ],
  },
  notfound: {
    icon: '🔌',
    title: 'No se encontró cámara',
    text: 'No detectamos ninguna cámara conectada al dispositivo.',
    steps: ['Conecta o habilita una cámara.', 'Pulsa "Reintentar".'],
  },
  inuse: {
    icon: '⏳',
    title: 'Cámara ocupada',
    text: 'Otra aplicación está usando la cámara en este momento.',
    steps: ['Cierra otras apps que usen la cámara.', 'Pulsa "Reintentar".'],
  },
  insecure: {
    icon: '🔒',
    title: 'Se requiere HTTPS',
    text: 'El navegador sólo permite la cámara en sitios seguros (HTTPS).',
    steps: ['Abre la app mediante una URL https://', 'Pulsa "Reintentar".'],
  },
  overconstrained: {
    icon: '🎚️',
    title: 'Resolución no disponible',
    text: 'No se pudo iniciar la cámara con la resolución solicitada.',
    steps: ['Pulsa "Reintentar" para usar una resolución menor.'],
  },
  unknown: {
    icon: '⚠️',
    title: 'No se pudo iniciar la cámara',
    text: 'Ocurrió un error inesperado al acceder a la cámara.',
    steps: ['Recarga la página.', 'Pulsa "Reintentar".'],
  },
};

function showModal(error) {
  const code = error instanceof CameraError ? error.code : 'unknown';
  const info = ERROR_INFO[code] || ERROR_INFO.unknown;
  elModalIcon.textContent = info.icon;
  elModalTitle.textContent = info.title;
  elModalText.textContent = info.text;
  elModalSteps.innerHTML = '';
  for (const step of info.steps) {
    const li = document.createElement('li');
    li.textContent = step;
    elModalSteps.appendChild(li);
  }
  elModal.classList.remove('hidden');
}

function hideModal() {
  elModal.classList.add('hidden');
}

/* --------------------------- Canvas / render -------------------------- */

function resizeCanvas() {
  // Limita el DPR a 2 para no drenar batería en pantallas muy densas.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const nw = Math.max(1, Math.round(cw * dpr));
  const nh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== nw || canvas.height !== nh) {
    canvas.width = nw;
    canvas.height = nh;
  }
}

/** Dibuja el "cuadro fotográfico": invierte colores SÓLO dentro del rectángulo. */
function drawPhotoFrame(ctx, f) {
  if (!frameRect) return;
  const { map, video, w, h } = f;

  const a = map(frameRect.x, frameRect.y);
  const b = map(frameRect.x + frameRect.width, frameRect.y + frameRect.height);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const rw = Math.abs(b.x - a.x);
  const rh = Math.abs(b.y - a.y);

  // Recorte y filtro especial exclusivo del área.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, rw, rh);
  ctx.clip();
  drawVideoCover(ctx, video, w, h, {
    mirror: f.mirror,
    filter: 'invert(1) contrast(1.15) saturate(1.25)',
  });
  ctx.restore();

  // Marco "glass" con esquinas tipo visor.
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(52,224,255,0.85)';
  ctx.shadowBlur = w * 0.02;
  ctx.lineWidth = Math.max(2, w * 0.004);
  ctx.strokeRect(x, y, rw, rh);

  const c = Math.min(rw, rh) * 0.12;
  ctx.lineWidth = Math.max(3, w * 0.006);
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + rw, y, -1, 1],
    [x, y + rh, 1, -1],
    [x + rw, y + rh, -1, -1],
  ]) {
    ctx.moveTo(cx, cy + sy * c);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + sx * c, cy);
  }
  ctx.stroke();
  ctx.restore();
}

function updateFps(now) {
  const dt = now - lastFrameTime;
  if (dt > 0) {
    const inst = 1000 / dt;
    fpsEma = fpsEma ? fpsEma * 0.9 + inst * 0.1 : inst;
  }
  if (now - lastFpsUpdate > 400) {
    lastFpsUpdate = now;
    elFps.textContent = `${Math.round(fpsEma)} FPS`;
  }
}

function render(now) {
  rafId = requestAnimationFrame(render);

  if (!video.videoWidth || !video.videoHeight) return;
  resizeCanvas();

  const w = canvas.width;
  const h = canvas.height;
  const dt = lastFrameTime ? now - lastFrameTime : 16;

  const map = makeMapper(video, w, h, mirror);

  // Puntos de mano (centro de palma) en píxeles, para filtros reactivos.
  const handPoints = [];
  const lms = latestResults?.multiHandLandmarks || [];
  for (const lm of lms) handPoints.push(map(lm[9].x, lm[9].y));

  // Movimiento del centroide (reservado para reactividad/animaciones).
  let motion = 0;
  if (lms.length) {
    const c = centroid(lms[0]);
    if (prevCentroid) motion = Math.hypot(c.x - prevCentroid.x, c.y - prevCentroid.y);
    prevCentroid = c;
  } else {
    prevCentroid = null;
  }

  const frame = { video, results: latestResults, w, h, time: now, dt, mirror, map, handPoints, motion };

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  FILTERS[currentFilter].draw(ctx, frame);
  drawPhotoFrame(ctx, frame);
  ctx.restore();

  updateFps(now);
  lastFrameTime = now;
}

function startRenderLoop() {
  cancelAnimationFrame(rafId);
  lastFrameTime = 0;
  rafId = requestAnimationFrame(render);
}

/* ---------------------- Procesado de resultados ----------------------- */

function onResults(results) {
  latestResults = results;
  const now = performance.now();

  const hands = results.multiHandLandmarks || [];
  elHands.textContent = `${hands.length} ✋`;

  // Gesto 2: cuadro fotográfico (tiene prioridad sobre el swipe).
  frameRect = detectFrameRect(hands);

  // Gesto 1: swipe horizontal para cambiar de filtro (suprimido si hay marco).
  if (frameRect) {
    swipe.reset();
    hideHintOnce();
    return;
  }

  let point = null;
  if (hands.length) {
    point = centroid(hands[0]);
    hideHintOnce();
  }

  let dir = swipe.update(point, now);
  if (dir) {
    // Ajuste para que el sentido coincida con lo que el usuario ve (espejo).
    if (mirror) dir = dir === 'right' ? 'left' : 'right';
    cycleFilter(dir === 'right' ? 1 : -1);
  }
}

/* ----------------------------- Arranque ------------------------------- */

async function init() {
  elLoading.classList.remove('hidden');
  hideModal();

  if (!tracker) {
    tracker = createHandTracker({ onResults, maxNumHands: 2 });
  }

  if (!cam) {
    cam = createCameraController(video, {
      onFrame: async () => {
        try {
          await tracker.send(video);
        } catch (_) {
          /* frame perdido: ignorar y continuar */
        }
      },
    });
  }

  try {
    await cam.start();
    mirror = cam.facingMode === 'user';
    tracker.setOptions({ selfieMode: mirror });
    elLoading.classList.add('hidden');
    startRenderLoop();
  } catch (err) {
    elLoading.classList.add('hidden');
    showModal(err);
  }
}

/* ------------------------------ Eventos ------------------------------- */

btnRetry.addEventListener('click', () => {
  init();
});

btnSwitch.addEventListener('click', async () => {
  try {
    const facing = await cam.switchCamera();
    mirror = facing === 'user';
    tracker.setOptions({ selfieMode: mirror });
    toast(mirror ? '🤳 Cámara frontal' : '📷 Cámara trasera');
  } catch (err) {
    showModal(err);
  }
});

btnCapture.addEventListener('click', () => {
  if (!canvas.width) return;
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `liquid-ar-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('📸 Captura guardada');
    },
    'image/png'
  );
});

// Pausa el bucle de render cuando la pestaña no es visible (ahorro de batería).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
  } else if (video.videoWidth) {
    startRenderLoop();
  }
});

buildChips();
init();
