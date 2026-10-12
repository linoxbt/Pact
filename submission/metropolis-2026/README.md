# PACT Metropolis submission kit

Prepared for the **Trust, Identity & AI Infrastructure** primary track. The deadline displayed in the supplied submission form is **14 October 2026, 04:59 GMT+1**; verify the countdown in the portal before uploading. This directory is submission collateral, not evidence that the portal entry has been saved or completed.

## Field map

| Portal field | File or value | State |
| --- | --- | --- |
| Project name, short description, full description | [ENTRY.md](ENTRY.md) | Ready to paste |
| First users and how to reach them | [ENTRY.md](ENTRY.md) | Ready to paste |
| Repository | `https://github.com/linoxbt/Pact` | Public URL |
| Project logo | [pact-logo.png](assets/pact-logo.png) | Ready to upload; 1024 × 1024 PNG |
| Live product | `https://pact-protocol-monad.alemzdelight.workers.dev/` | Live Monad testnet site |
| Steps to try the product | [ENTRY.md](ENTRY.md) | Ready to paste; fees and self-signup disclosed |
| Project overview PDF | [Pact-Overview.pdf](Pact-Overview.pdf) | Two-page judge brief |
| Presentation | [Pact-Pitch-Deck.pptx](Pact-Pitch-Deck.pptx), [PDF](Pact-Pitch-Deck.pdf) | Twelve editable slides plus PDF export |
| Demo video, up to 3 minutes | [Pact-Brand-Film-3min.mp4](media/brag-visa-inspired/Pact-Brand-Film-3min.mp4), [analysis](media/REFERENCE_VIDEO_ANALYSIS.md) | 3:00 narrated motion film; upload this single MP4 to a video host |
| Demo thumbnail | [Pact-Brand-Film-Poster.jpg](media/brag-visa-inspired/Pact-Brand-Film-Poster.jpg) | Upload with the narrated film where supported |
| Pitch video, up to 2 minutes | [Pact-Pitch-1m48.mp4](Pact-Pitch-1m48.mp4), [script](PITCH_VIDEO.md) | 1:48 caption-led film; upload to a video host |
| Combined film | [Pact-Complete-Submission-Film.mp4](Pact-Complete-Submission-Film.mp4) | 4:48 archive copy; not for either portal duration-limited field |
| Optional promo clip, up to 30 seconds | [PITCH_VIDEO.md](PITCH_VIDEO.md) | Optional; upload only if made |
| Optional X account | Only enter an actual project account | No account supplied |

The two mandatory video URLs still require hosting. Upload the single three-minute narrated demo MP4 and the separate pitch MP4 to YouTube, Loom, Vimeo, or another accepted host, verify playback in a signed-out browser, then paste the real HTTPS links into the portal. The combined archive film exceeds both field limits. The narrated demo shows the public product and a real Explorer receipt interaction with historical test evidence. It does **not** show a new authenticated Console session; a fresh interactive walkthrough is the stronger judging submission if one can be recorded. [RECORDING_CHECKLIST.md](RECORDING_CHECKLIST.md) covers the final check.

## Evidence and wording boundaries

- [Live agent test report](../../docs/verification/2026-10-08-live-agent.md): recorded model calls, gateway decisions, Monad testnet transactions, obligation settlement, and limitations.
- [Accounting design](../../docs/protocol/ACCOUNTING.md): exact transfer and one funded milestone are supported; recurring agreements require an additional adapter.
- [Action fees](../../docs/operations/ACTION_FEES.md): four new resource types cost 5 native MON each when fees are enabled. The current site is testnet; a fresh full setup needs at least 20 testnet MON plus gas.
- [Public receipt](https://pact-api-production-2ab9.up.railway.app/v1/receipts/1): a testnet receipt with a reported valid root. The receipt is independently checkable against the transaction trail; private HTTP activity is not an anchored receipt.

The historical Railway test agent's task token and test upstream expired after its October 8 verification. Refresh its resources before filming a new live run. Its recorded transactions and public receipt remain useful evidence. Mainnet execution, automatic recurring-contract valuation, and production custody are **not** claimed in this entry.
