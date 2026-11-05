// 번역 결과 캐시 (메모리 + chrome.storage.session, LRU) — background 전용
const CACHE_MAX = 600;
const cache = new Map();
let cacheLoaded = null;
let persistTimer = 0;

function loadCache() {
  if (!cacheLoaded) {
    cacheLoaded = chrome.storage.session.get('cache').then(({ cache: arr }) => {
      if (Array.isArray(arr)) for (const [k, v] of arr) if (!cache.has(k)) cache.set(k, v);
    }).catch(() => {});
  }
  return cacheLoaded;
}

export async function cacheGet(k) {
  await loadCache();
  if (!cache.has(k)) return null;
  const v = cache.get(k);
  cache.delete(k); cache.set(k, v); // LRU 갱신
  return v;
}

export function cacheSet(k, v) {
  cache.set(k, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    chrome.storage.session.set({ cache: [...cache] }).catch(() => {});
  }, 500);
}
