# Public product experience

The Console frontend serves `/` (product page), `/docs`, `/explorer`, and `/app`.
`Landing.tsx` and `landing.css` contain the product page; marketing styles are scoped
so the authenticated workspace keeps its existing branding and layout.

## Interactive boundaries

The policy playground calls `evaluateHttpPolicy` from `@pact/policies`, the same
pure evaluator used by the gateway. It uses a clearly labeled local fixture:

- GET `/tickets/:id`: allowed until the fixture's 100-request limit.
- POST `/refunds`: requires approval.
- DELETE: denied by grant action bounds.
- Unmatched routes: denied by default.

The playground does not authenticate a key, forward HTTP, send funds, or create
activity. Its output is not evidence of a live request. The product walkthrough
also labels its example workspace. Neither section presents example records as
customer activity.

`/app#verification` opens the existing authenticated enforcement check. It tests
the real API, gateway, database, demo upstream, approvals, key rotation and
revocation in the signed-in owner's workspace. User sign-in is required.

## Assets and checks

Photographs are served locally as compressed WebP files. Sources and licensing
are recorded in `apps/console/public/images/CREDITS.md`. They illustrate work
settings, not customer endorsements. Below-the-fold photos use lazy loading.
Animations respect reduced-motion preferences.

```sh
pnpm --filter @pact/console build
CHROME_PATH=/usr/bin/google-chrome node apps/console/test/landing.mjs
```

The browser check exercises the built assets, policy outcomes, editable request
fields, product tabs, code tabs, clipboard, FAQ, mobile menus, image loading,
documentation, and the Console sign-in route. It does not log in as a user.
The full CI workflow also runs the separate Console integration test with an
isolated test identity and real API/database/gateway requests.

To repeat public checks against a release:

```sh
PACT_PUBLIC_TEST_URL=https://pact-protocol-monad.alemzdelight.workers.dev \
CHROME_PATH=/usr/bin/google-chrome node apps/console/test/landing.mjs
```
