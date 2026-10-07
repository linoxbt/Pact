#!/bin/sh
set -eu
case "${PACT_SERVICE:-}" in
  api|gateway|worker|indexer|runner) ;;
  *) echo "PACT_SERVICE must be api, gateway, worker, indexer, or runner" >&2; exit 64 ;;
esac
if [ "$PACT_SERVICE" = worker ] && [ "${PACT_ENABLE_RUNNER:-no}" = yes ]; then
  exec node scripts/worker-services.mjs
fi
exec node "apps/${PACT_SERVICE}/dist/main.js"
