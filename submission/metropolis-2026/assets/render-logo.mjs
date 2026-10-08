import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('./pact-logo.svg', import.meta.url));
await sharp(svg).png({ compressionLevel: 9, palette: true }).toFile(new URL('./pact-logo.png', import.meta.url).pathname);
