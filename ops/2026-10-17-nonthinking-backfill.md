# Restore non-thinking generation and recover missing recent assets

- Authorization: user requested disabling thinking and filling the last two days; clarified scope is Qiaomu rewrites and Chinese titles only.
- Window: entries collected from 2026-10-16 00:00 +08:00 through this run on 2026-10-17. Preserve existing assets, deleted entries, disabled sources and sources with autoRewrite=false.
- Baseline: GitHub main 9a2948e (v1.0.3), production e5f1845, identical source tree. Isolated branch codex/restore-nonthinking-backfill; existing dirty Reader/plugin workspaces untouched.
- Confirmed: example IDs e8d512d29ac502637b16226e61c8dedc and 09ccb64979f91cb6ab44973b62f07145 have no rewrite rows. Substack has source HTML; Joe Rogan has a 146467-character full transcript, but no digest.
- 2026-10-16 allowance: 87 calls reserved 4995468/5000000 units before Substack entry arrived. Successful usage never settles reservations. This is a local safety allowance, not a DeepSeek invoice.
- Snapshot: 180 collected entries, 96 in enabled auto-rewrite sources, 58 missing rewrites. Existing refresh only enqueues changed sources; missing assets can remain after failures.
- Plan: disable thinking; settle known successful usage without removing budget/concurrency checks; provide resumable missing-only backfill; verify production records and public GETs; publish through existing release flow.
- Pre-deployment verification: 118 Node tests, 8 reliability tests, 3 Python tests, production dependency audit (zero vulnerabilities). The old code failed the three new thinking/settlement assertions before the fix. Production verification and backfill results are recorded in the deployment report and release notes after execution.
