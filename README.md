# Liquid AR · WebAR Hand Tracking

Aplicación web de Realidad Aumentada que usa la cámara del dispositivo y
**MediaPipe Hands** para hacer *tracking* de manos de alta precisión (hasta 2
manos), interpretar gestos y aplicar filtros en tiempo real sobre un `<canvas>`
a pantalla completa, con una interfaz **Liquid Glass** (Glassmorphism).

Empaquetada con **Vite** y desplegable automáticamente en **GitHub Pages**.

## ✨ Características

- **Tracking de 2 manos** con MediaPipe Hands (`maxNumHands: 2`).
- **Gesto 1 — Swipe:** un movimiento horizontal rápido del centroide de la mano
  cambia de filtro cíclicamente, con *cooldown* de 1.5 s para evitar saltos.
- **Gesto 2 — Cuadro fotográfico:** con ambas manos, las yemas de pulgares
  (landmark 4) e índices (landmark 8) delimitan un rectángulo; dentro de él se
  aplica un efecto de **inversión de color** usando `ctx.clip()`.
- **Filtros:** Original, **Letras AR** (Matrix/Cyber con `globalCompositeOperation:
  'screen'` y reactivo a la mano), Neón, Térmico y Pop Art.
- **UI Glassmorphism** mobile-first, responsive y consciente de la orientación.
- **Manejo de permisos:** modal elegante con instrucciones si se deniega la cámara.
- **Extras:** cambio de cámara (trasera/frontal) y captura de foto (PNG).

## 🏗️ Arquitectura

```
.
├── index.html              # <video> oculto, <canvas> a pantalla completa y UI flotante
├── vite.config.js          # base configurable para GitHub Pages (BASE_PATH)
├── package.json
├── .github/workflows/
│   └── deploy.yml           # CI/CD a GitHub Pages
└── src/
    ├── styles.css           # CSS variables, Glassmorphism, mobile-first
    ├── camera.js            # cámara (facingMode 'environment'), resoluciones, permisos
    ├── vision.js            # MediaPipe Hands (maxNumHands: 2) + callbacks
    ├── gestures.js          # matemática de gestos (swipe, cuadro fotográfico)
    ├── filters.js           # utilidades de render + catálogo de filtros
    └── main.js              # controlador: sincroniza video/canvas y rAF
```

**Doble bucle** (rendimiento): `@mediapipe/camera_utils` bombea frames al modelo
(`onFrame → hands.send`), mientras `requestAnimationFrame` se encarga del render
fluido del canvas usando los últimos resultados disponibles.

Los binarios de MediaPipe (`.wasm/.data/.tflite`) se cargan vía `locateFile`
desde un CDN fijado a la versión exacta del paquete npm, garantizando
compatibilidad y rutas correctas en GitHub Pages.

## 🚀 Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173 (host expuesto para probar en el móvil)
```

> La cámara requiere un **contexto seguro**. `localhost` cuenta como seguro; para
> probar desde el móvil en la red local usa un túnel HTTPS (p. ej. `ngrok`) o el
> propio despliegue en GitHub Pages.

Build y previsualización:

```bash
npm run build
npm run preview
```

## 📦 Despliegue en GitHub Pages

1. En el repositorio: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**.
2. Haz *push* a `main` (o a la rama de trabajo). El workflow
   `.github/workflows/deploy.yml` compila con Vite e inyecta automáticamente
   `BASE_PATH=/<nombre-del-repo>/` para que las rutas de los assets funcionen.
3. La app quedará disponible en `https://<usuario>.github.io/<repo>/`.

## 🎮 Uso

- **Cambiar filtro:** desliza la mano rápidamente de izquierda a derecha (o
  viceversa). También puedes tocar los *chips* inferiores.
- **Cuadro fotográfico:** forma una "L" con cada mano y enfréntalas para crear un
  rectángulo; dentro se invierten los colores.
- **🔄** cambia entre cámara trasera y frontal · **📸** guarda una captura PNG.

## 🧰 Stack

- [Vite](https://vitejs.dev/)
- [@mediapipe/hands](https://www.npmjs.com/package/@mediapipe/hands)
- [@mediapipe/camera_utils](https://www.npmjs.com/package/@mediapipe/camera_utils)
- Canvas 2D + CSS Glassmorphism (sin frameworks de UI)
