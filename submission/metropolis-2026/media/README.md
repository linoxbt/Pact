# Submission media sources

`build.mjs` generates the HTML sources and editable PPTX. `build-video.mjs` generates ten Brag/Hyperframes chapter compositions from the verified Pact submission copy. The `Pact-Overview.pdf`, `Pact-Pitch-Deck.pdf` and finished videos are checked-in deliverables.

Build on Node 22 with `npm ci`, then `npm run build`. Print each HTML file with Chromium/Chrome using `--headless --no-sandbox --no-pdf-header-footer --print-to-pdf=<output> file://<absolute-html-path>`. Render each `brag-chapters/NN` directory with `npx hyperframes render ... -f 8 -q draft`. Concatenate chapters in order with FFmpeg. The media source screenshots were captured from the public product on 12 October 2026; they are product captures, not fabricated private dashboard data.

The supplied three-minute film is caption-led. `DEMO_VIDEO.md` contains a spoken script and instructions for recording a fresh interactive Console demonstration. The product screenshot and historical testnet evidence should not be represented as a new authenticated run.
