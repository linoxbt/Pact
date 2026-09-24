#!/bin/sh
set -eu
case "${PACT_SERVICE:-}" in
  api|gateway|worker|indexer|runner) ;;
  *) echo "PACT_SERVICE must be api, gateway, worker, indexer, or runner" >&2; exit 64 ;;
esac
exec node "apps/${PACT_SERVICE}/dist/main.js"
