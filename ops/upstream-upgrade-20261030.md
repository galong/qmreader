# Upstream upgrade 2026-10-30

Merged upstream v1.0.15 (`13b9b409a4fd741092cc40a044f6bb095f3677ec`) into the fork based on `de535329e610d616bf3772a341570b3d0c272c29`.
The merge retains the fork's 13 commits in Git ancestry; it does not replace them with an upstream checkout.

Preserved deployment-specific behavior:

- Fintech News America, Fintech News Africa, Flagship Advisory Partners and PYMNTS sources.
- Persisted per-source automatic processing toggles, source removal/restoration and disabled public registration support.
- `AUTO_REWRITE_CONTENT_ENABLED=0`: automatic titles only; no automatic body translations or rewrites, including new durable queue producers/consumers and submission processing.
- Existing daily processing window support; production's equal start/end hours mean all day.
- Server-owned OpenAI-compatible credentials and model selection for both background titles and manual reader generation; caller headers cannot redirect server-owned credentials.
- Immutable GHCR images, loopback-only Docker port, data/config backups and rollback deployment script.
- Upstream reading performance replaces overlapping older frontend optimizations.

Docker additionally packages `.rss-reliability`, now required by upstream runtime modules. The image embeds its Git revision for `/api/version`.

Before deployment: full Node suite, reliability tests, Python deployment/health checks and production dependency audit. Deployment preserves `.env`, `.deploy.env` and `data/` and records a stopped-container data backup before the image switch.
