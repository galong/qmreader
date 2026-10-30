# Server-funded AI limits

Server-funded calls previously required login and locked the model in request configuration, but had no shared spend or concurrency allowance. The last network boundary also accepted a body model override. Direct-origin callers could spoof CF-Connecting-IP to evade IP-based registration/login throttles.

This change reserves an upper-cost allowance before every upstream attempt, including retries and background workers. SQLite transactions share reservations across processes and restarts. Defaults: 5 CNY of conservative reservations per Shanghai day, 10 attempts/minute and 100/day per account, 3 globally concurrent requests and 2 per account. Input is limited to 100,000 UTF-8 bytes and output to 9,000 tokens. The reservation uses Flash peak prices (2 CNY/M input and 8 CNY/M output), an input-byte upper estimate, and protocol overhead; failed requests retain reservations. This is a site safety allowance, not an account-wide billing cap. Prices require review if the provider changes its tariff.

Only Flash and the official HTTPS endpoint are permitted at the network boundary. Redirects fail closed. The audit database stores actor, model, status, reservation and reported token counts; no key or prompt is stored. BYOK calls do not use the website allowance.

The proxy chain trusts loopback only; CF-Connecting-IP is accepted only for Cloudflare edge ranges verified against https://www.cloudflare.com/ips-v4/ and https://www.cloudflare.com/ips-v6/. Direct-origin headers cannot change the limiter identity.

Configuration: AI_DAILY_BUDGET_MICROS (0 disables server-funded calls), AI_USER_REQUESTS_PER_MINUTE, AI_USER_REQUESTS_PER_DAY, AI_MAX_CONCURRENT. Database: ai-spend.sqlite beside the main database. Invalid limits and storage failures deny paid calls.

Validation: the model override and forged-IP regression tests failed on the original code. Updated suite: 107 tests pass, reliability suite 8 pass, release installer 2 pass and health test 1 pass. Coverage includes cross-connection reservations, restarts, day rollover, per-account limits, concurrency, failed calls and zero budget.

Deploy with scripts/deploy-release.py using a merged GitHub main revision. It preserves configuration/data, verifies deployed file digests, and creates a rollback backup. This change does not establish the source of all DeepSeek account charges.
