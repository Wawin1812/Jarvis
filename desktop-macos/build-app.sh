#!/bin/sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"


APP="$ROOT/.build/JARVIS.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -parse-as-library -O Sources/JarvisDesktop/main.swift -o "$APP/Contents/MacOS/JARVIS"
cp Info.plist "$APP/Contents/Info.plist"
chmod 755 "$APP/Contents/MacOS/JARVIS"
codesign -s - --force "$APP" >/dev/null
echo "Built $APP"
