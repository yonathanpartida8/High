#!/data/data/com.termux/files/usr/bin/bash
#
# Liquid AR — arranque rápido en Termux (Android).
#
# Uso (una sola vez, dentro de Termux):
#   bash termux-setup.sh
#
# Luego, en Chrome del MISMO teléfono, abre:  http://localhost:5173
# (localhost es un "contexto seguro", así que la cámara funciona sin HTTPS.)
#
set -e

echo "==> Actualizando paquetes de Termux…"
pkg update -y
pkg upgrade -y

echo "==> Instalando Node.js y git…"
pkg install -y nodejs git

echo "==> Node:  $(node -v)"
echo "==> npm:   $(npm -v)"

echo "==> Instalando dependencias del proyecto…"
npm install --no-audit --no-fund

echo ""
echo "============================================================"
echo "  Listo. Arrancando el servidor de desarrollo…"
echo "  Abre en Chrome (mismo teléfono):  http://localhost:5173"
echo "  Detén con Ctrl+C."
echo "============================================================"
echo ""

npm run dev -- --host
