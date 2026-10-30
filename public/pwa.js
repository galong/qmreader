'use strict';

// Let the browser offer installation. Keep the reader free of unsolicited prompts.
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch(error => console.warn('离线提示暂不可用:', error.message));
  }, { once: true });
}
