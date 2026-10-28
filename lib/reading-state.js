'use strict';

// A successful read with no asset is not a failed network request or proof that
// generation is running. Only a live job may advertise active processing.
function readingAssetState({ asset, kind = 'rewrite', job, automatic = false, exactAsset = false, now = Date.now() }) {
  const ready = kind === 'translation' ? Boolean(asset?.content?.length) : Boolean(asset?.body?.trim());
  if (ready) return { status: 'ready', automatic, retryAfterMs: 0 };
  if (exactAsset || kind === 'translation') return { status: 'unavailable', automatic: false, retryAfterMs: 0 };
  // Settled outcomes stay true until the article changes, however old they are.
  if (job && job.status === 'skipped') {
    return { status: 'unavailable', automatic, retryAfterMs: 0, reason: job.lastError || '' };
  }
  if (job && job.status === 'failed') {
    return { status: 'failed', automatic, retryAfterMs: 0 };
  }
  const recent = job && job.updatedAt > now - 15 * 60 * 1000;
  let status = automatic ? 'not_ready' : 'unavailable';
  if (recent) {
    if (job.status === 'running' && job.leaseUntil > now) status = 'processing';
    else if (job.status === 'pending') status = 'queued';
    else if (job.status === 'retry') status = 'retrying';
  }
  // A scheduled retry is real work, but polling for it every few seconds is not.
  if (job && job.status === 'retry' && job.availableAt > now) status = automatic ? 'waiting' : 'unavailable';
  const active = ['queued', 'processing', 'retrying'].includes(status);
  return { status, automatic, retryAfterMs: active ? 5000 : status === 'not_ready' ? 10000 : 0 };
}

module.exports = { readingAssetState };
