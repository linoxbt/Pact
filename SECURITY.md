# Security status and reporting

Pact currently contains unaudited local-development contracts. Do not deploy them to custody real funds. The architecture explicitly depends on the agent having no unrestricted principal key or raw provider credential.

Report suspected vulnerabilities privately through the repository's GitHub Security Advisory workflow. Include affected commit, impact, reproduction steps, and whether funds or secrets may be at risk. Do not include private keys or live credentials in a report.

The current implementation enforces one token and one recipient per grant, exact action hashes, bounded capacity, typed approvals, full-funded single-milestone escrow, and immutable final receipt anchors. It does not enforce arbitrary JSON policy fields or establish that a verifier's private evidence is true. The verifier and arbitrator are explicitly trusted parties in each signed obligation.

Before any live deployment, the project needs an independent contract and service review, deeper invariant testing, asset governance, key recovery, live monitoring and a restore/incident drill. The [audit handoff](docs/security/INDEPENDENT_AUDIT_HANDOFF.md) states the external review scope; it is not an audit report.
