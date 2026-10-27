// Service Worker — 注销开关 / unregister switch.
//
// 2026 世界杯页面曾用这个 SW 做离线缓存；现在它什么都不缓存：
// install 时直接 skipWaiting，activate 时删掉本域全部 cache 并注销自己，
// 让浏览器退回普通网络请求（/clear.html 是一键清缓存页）。
// The World Cup 2026 page used to cache assets here. Nothing is cached any
// more: install skips waiting, activate deletes every cache for this origin and
// unregisters the worker, so browsers fall back to plain network requests.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
  })());
});
