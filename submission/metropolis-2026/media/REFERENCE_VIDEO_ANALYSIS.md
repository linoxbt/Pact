# Reference motion analysis — Lino's “love this motion design video”

Source supplied by the project owner: `https://youtu.be/JWkpOazmVhk`; inspected from the owner-supplied MP4. `yt-dlp` was attempted on the Wormhole share, but Wormhole is not a supported extractor. The shared encrypted MP4 was retrieved through Wormhole's browser client, then probed and sampled with FFmpeg. Original video: 124.0 seconds, 1280 × 720, 30 fps, H.264 video and AAC audio. The reference file and its extracted frames are analysis material and are not redistributed in this repository.

## What the film actually demonstrates

This is a Visa brand-system case study, not a web or mobile application walkthrough. It introduces a brand idea, shows visual rules (color, typography, double-bar symbol, line art, photography), and then shows those rules applied to posters, spaces, apparel, packaging, a mobile screen and a contactless payment mockup. It does not show navigation menus, account setup, form submission, backend state or a real transaction. Any “tap to pay” imagery is a visual application, not proof of an interactive payment flow.

## Timeline and frame evidence

| Time | Frame/layout | Motion and edit | Pact adaptation |
| --- | --- | --- | --- |
| 0–11s | Almost entirely white canvas, small centered black sentences. Thin blue/yellow curves grow out of the type. | Restrained opening: one thought at a time; lines extend and bend across the canvas. | Ask who authorized the agent, then draw Pact's authority boundary in forest/mint. |
| 11–18s | “But, we are so much more” expands between radiating curves; a delivery person and other people appear on white. | Message widens into a human-scale system; white cutout imagery enters from edges. | Move from API-key problem to people/teams controlling agents; use Pact's licensed site photography, not Visa footage. |
| 18–26s | A full cobalt card announces a new strategy; the wordmark and real-world sign shots follow. | Hard color fill, then fast brand reveal and product-context cuts. | Use Pact forest fill and mint accent bars, then real Pact landing/docs captures. |
| 26–36s | Huge cropped black and blue letters assemble “CONNECT”; two horizontal bars resolve on white. | Oversized type is deliberately clipped beyond the frame; fast letter-to-symbol morph. | Kinetic “CONNECT / CONTROL / VERIFY” with Pact's own shapes and color system. |
| 36–47s | Short words stack around the bars, then cutout people and large editorial photographs. | Fast-in type with readable holds; photography interleaved with the recurring symbol. | Human owner, agent, endpoint and policy labels; photos with brand overlays. |
| 47–70s | Brand-system modules: portrait in a frame, word clouds for color/type/motion, striped palettes, very large type, phone and icon examples. | Editorial grid and split-screen; sections switch on hard cuts while type scale changes dramatically. | Actual Pact docs and public product UI, with an original animated request-policy diagram. |
| 70–88s | People and work scenes become an expanding visual grid of many brand applications. | Tiles multiply; camera seems to pull back while content remains aligned on a modular grid. | An original grid of Agents, Endpoints, Policies, Activity, SDK/MCP and Explorer; no fabricated private activity records. |
| 88–116s | The grid gives way to rapid real-world applications: posters, store signs, door graphics, phone, watch, packaging. | Dense montage with many cuts around 0.5–1.5 seconds. | Rapid montage of real Pact public screens, docs, testnet Explorer interaction, and developer integration details. |
| 116–124s | White background returns, one short declarative sentence, then centered Visa mark and tagline. | Pace drops; minimal final lockup. | Settle on a concise Pact line and the live product URL. |

Automatic FFmpeg scene detection found particularly dense cut clusters at 23–27s and 88–115s, compared with longer holds in the opening and final line. This pacing difference is the most important structural cue to preserve.

## Visual and interaction system

- **Canvas:** 16:9 landscape; mostly white backgrounds and black sans-serif text; solid primary-color interludes. Lots of margin until deliberate type crops fill the frame.
- **Type:** very large geometric sans headlines, small centered narrative sentences, extreme size contrast. Words appear as individual graphic elements, sometimes extending beyond the edge.
- **Motif:** two stacked horizontal color bars recur as a connective symbol across type, people, products and spaces. Curved hairline paths also guide motion.
- **Photography:** isolated people on white, editorial photographs and environmental brand applications. Photos are composited into grids and masks rather than held as static slideshow cards.
- **Motion:** line drawing, word wipes, hard color cuts, masked reveals, quick scale and pan, grid expansion, and a quiet end card. Opening and outro read slowly; middle and final montage accelerate.
- **Touch/UI:** one phone shows contactless payment imagery; there is no observed tap sequence controlling a real UI. Pact's recreation should show a genuine public Explorer tap/click sequence rather than claim an unseen app interaction in the reference.
- **Sound:** the file has a continuous AAC soundtrack. Pact's adaptation adds original narration, a music bed, soft reveal impacts and restrained click/tap sounds timed to visible actions. It does not reuse the reference soundtrack.

## Re-creation method

Use Brag to plan 16–18 second Hyperframes chapters and FFmpeg to assemble the 124-second film. Build original Pact typography and boundary lines in HTML/SVG. Animate every element on a seek-safe GSAP timeline. Use the public product/docs and an actual Explorer receipt interaction as the real UI. Use Pact's own forest, mint and cream palette instead of Visa's blue/yellow, and only Pact-owned or licensed photos. Generate narration locally with Kokoro through Hyperframes; mix it with Brag's music and a few low-risk touch/impact effects. Mark the October 8 testnet run as recorded evidence; do not imply a new private Console execution.
