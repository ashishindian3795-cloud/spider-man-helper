import { cp, mkdir } from 'node:fs/promises';

await mkdir('.build/renderer/assets', { recursive: true });
await cp('src/renderer/index.html', '.build/renderer/index.html');
await cp('src/renderer/styles.css', '.build/renderer/styles.css');
await cp('src/renderer/preview.css', '.build/renderer/preview.css');
await cp('src/renderer/preview-bridge.js', '.build/renderer/preview-bridge.js');
await cp('assets/spider-man-cutout.png', '.build/renderer/assets/spider-man-cutout.png');
