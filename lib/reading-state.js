'use strict';

// A successful read with no asset is not a failed network request or proof that
// generation is running. Only a live job may advertise active processing.
function readingAssetState({ asset, kind = 'rewrite', job, automatic = false, exactAsset = false, now = Date.now() }) {
  const ready = kind === 'translation' ? Boolean(asset?.content?.length) : Boolean(asset?.body?.trim());
  if (ready) return { status: 'ready', automatic, retryAfterMs: 0 };
  if (exactAsset || kind === 'translation') return { status: 'unavailable', automatic: false, retryAfterMs: 0 };
  const recent = job && job.updatedAt > now - 15 * 60 * 1000;
  let status = automatic ? 'not_ready' : 'unavailable';
  if (recent) {
    if (job.status === 'running' && job.leaseUntil > now) status = 'processing';
    else if (job.status === 'pending') status = 'queued';
    else if (job.status === 'retry') status = 'retrying';
    else if (job.status === 'failed' || job.status === 'skipped') status = 'failed';
  }
  const active = ['queued', 'processing', 'retrying'].includes(status);
  return { status, automatic, retryAfterMs: active ? 5000 : status === 'not_ready' ? 10000 : 0 };
}

module.exports = { readingAssetState };
