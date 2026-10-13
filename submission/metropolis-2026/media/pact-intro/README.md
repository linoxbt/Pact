# Pact introduction film source

The official X launch post is [`PACT_X_INTRO.md`](../../PACT_X_INTRO.md). The final video and poster are `Pact-Intro-24s.mp4` and `Pact-Intro-Poster.jpg` in the submission root.

Run `npm ci` in the parent `media` directory, then `node pact-intro/build.mjs`. Check each `pact-intro/chapters/NN` with the parent `node_modules/.bin/hyperframes check`. Render each chapter to its `chapter.mp4` with `hyperframes render`, then run `python3 pact-intro/assemble.py`. FFmpeg is required. The chapter render files are build products and are not committed.

The captured Docs and Explorer images are from Pact's public site. The public Explorer image represents a recorded Monad testnet receipt. The gateway rail is an explanatory graphic. The film does not represent a new private HTTP request or claim that every request has an onchain receipt.

Audio: Brag's bundled music track and CC0 interface click/switch cues. The final cut is exactly 24 seconds, 1280 × 720, 30 fps, H.264/AAC.
