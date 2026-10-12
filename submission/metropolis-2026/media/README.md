# Submission media sources

`build.mjs` generates the HTML sources and editable PPTX. `build-video.mjs` generates ten Brag/Hyperframes chapter compositions from the verified Pact submission copy. The `Pact-Overview.pdf`, `Pact-Pitch-Deck.pdf` and finished videos are checked-in deliverables.

Build on Node 22 with `npm ci`, then `npm run build`. Print each HTML file with Chromium/Chrome using `--headless --no-sandbox --no-pdf-header-footer --print-to-pdf=<output> file://<absolute-html-path>`. Render each `brag-chapters/NN` directory with `npx hyperframes render ... -f 8 -q draft`. Concatenate chapters in order with FFmpeg. The media source screenshots were captured from the public product on 12 October 2026; they are product captures, not fabricated private dashboard data.

The three-minute demo is a narrated motion film. `DEMO_VIDEO.md` describes its scenes and the steps for recording a fresh interactive Console demonstration. The product screenshot and historical testnet evidence should not be represented as a new authenticated run.

The canonical [3:00 demo film](../Pact-Demo-3min.mp4) is a single narrated Brag/Hyperframes adaptation of the owner-supplied motion reference. [The frame analysis](REFERENCE_VIDEO_ANALYSIS.md) explains the source's pacing and design, and [the chapter source](brag-visa-inspired/build-motion.mjs) makes Pact's ten animated scenes editable. The film uses real public Pact captures, an explanatory policy diagram, and the October 8 testnet Explorer receipt; it does not claim a fresh authenticated Console run. The still [poster](brag-visa-inspired/Pact-Brand-Film-Poster.jpg) is also baked into frame 0 for video thumbnails.
