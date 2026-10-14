#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"
swift build -c release

APP="$ROOT/.build/JARVIS.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/JarvisDesktop "$APP/Contents/MacOS/JARVIS"
cp Info.plist "$APP/Contents/Info.plist"
chmod 755 "$APP/Contents/MacOS/JARVIS"
echo "Built $APP"
