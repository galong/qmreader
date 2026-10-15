function articleKey(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.hostname !== 'mp.weixin.qq.com' || url.pathname !== '/s') return '';
    const biz = url.searchParams.get('__biz');
    const mid = url.searchParams.get('mid');
    const idx = url.searchParams.get('idx');
    if (!biz || !/^\d+$/.test(mid || '') || !/^\d+$/.test(idx || '')) return '';
    return `${biz}|${mid}|${idx}`;
  } catch { return ''; }
}

module.exports = { articleKey };
