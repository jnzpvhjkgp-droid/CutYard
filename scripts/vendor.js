// Kopierar tredjepartsfiler från node_modules till vendor/ och assets/fonts/
// så att appen kan köras helt utan CDN (och offline som PWA).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const files = {
    'node_modules/three/build/three.min.js': 'vendor/three.min.js',
    'node_modules/three/examples/js/controls/OrbitControls.js': 'vendor/OrbitControls.js',
    'node_modules/qrcode-generator/dist/qrcode.mjs': 'vendor/qrcode.mjs',
    'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2': 'assets/fonts/inter-400.woff2',
    'node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2': 'assets/fonts/inter-500.woff2',
    'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2': 'assets/fonts/inter-600.woff2',
    'node_modules/@fontsource/inter/files/inter-latin-700-normal.woff2': 'assets/fonts/inter-700.woff2',
    'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2': 'assets/fonts/jetbrains-mono-400.woff2',
    'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2': 'assets/fonts/jetbrains-mono-700.woff2'
};

for (const [from, to] of Object.entries(files)) {
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`${from} -> ${to}`);
}
