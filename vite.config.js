import { defineConfig } from 'vite';

/**
 * Configuración de Vite.
 *
 * `base` controla el prefijo de rutas de los assets generados. En GitHub Pages,
 * un "project site" se sirve desde https://<usuario>.github.io/<repo>/, por lo
 * que necesitamos `base = '/<repo>/'`. Para no acoplar el nombre del repo aquí,
 * el workflow de GitHub Actions inyecta `BASE_PATH` automáticamente a partir del
 * nombre del repositorio. En local (`npm run dev`/`preview`) se usa la raíz '/'.
 */
export default defineConfig(() => ({
  base: process.env.BASE_PATH || '/',
  server: {
    host: true, // expone la red local para probar desde el móvil (mismo Wi-Fi)
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2019',
    sourcemap: false,
  },
}));
