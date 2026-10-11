// Keeps the game up to date without a build step or version numbers in file names.
// Every file the page asks for is checked against the server (a cheap "not modified"
// when nothing changed), so opening or refreshing the page always runs the latest
// deploy instead of scripts the browser cached earlier. It never reloads a page.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  // Offline or a flaky network: fall back to whatever the browser has.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).catch(() => fetch(e.request)));
});
