# Pact brand film

The [final 3:00 MP4](Pact-Brand-Film-3min.mp4) is the single finished 1280 × 720, 30 fps film. [Poster](Pact-Brand-Film-Poster.jpg) is its first frame and an uploadable thumbnail. See the [reference analysis](../REFERENCE_VIDEO_ANALYSIS.md) for the timestamped visual breakdown.

Ten Brag/Hyperframes scenes are authored by `build-motion.mjs`. Run it from any directory with Node 22 after `npm ci` in the parent `media` directory. Each generated `chapters/NN` is an independent, seek-safe composition. Validate each with `../../../node_modules/.bin/hyperframes check`, render to `chapter.mp4`, then concatenate in order into the single MP4. `assemble-voice.py` places the locally generated voice clips on the 180-second timeline. The final mix adds Brag's music and timed click and soft-impact cues with FFmpeg. The original reference footage and soundtrack are not included.

The live site screenshots in `assets/` were captured from the public product on 12 October 2026. The receipt scene labels the October 8 historical Monad testnet run. The policy diagram is an explanation, not a fabricated live request. Private gateway activity remains an operator record unless anchored on-chain.
