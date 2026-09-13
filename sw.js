/* Habit Tracker service worker.
   The whole app is a single index.html (all CSS/JS inline) plus the
   manifest and a handful of icons, so the "app shell" is small and
   simple to precache in full.

   Update strategy: bump CACHE_VERSION on every release. A new version
   installs its own cache alongside the old one, activates (deleting any
   older habit-tracker-shell-* caches), and takes over immediately via
   skipWaiting()/clients.claim() — so a person who reopens the app after
   a release gets the new version without being permanently stuck on an
   old build, while still not clobbering anything until the new shell is
   fully cached.

   Fetch strategy: network-first with cache fallback for same-origin GET
   requests. This keeps online users on the freshest index.html (a pure
   cache-first strategy could otherwise get someone stuck on a stale
   build indefinitely), while still serving the last-cached shell when
   offline — which is what makes "launch offline after first successful
   load" work. Cross-origin and non-GET requests are left completely
   alone (no external network dependency either way). */

var CACHE_VERSION = "v1.2.0";
var CACHE_NAME = "habit-tracker-shell-" + CACHE_VERSION;
var CACHE_PREFIX = "habit-tracker-shell-";

var SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.png",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-512-maskable.png"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache){ return cache.addAll(SHELL_FILES); })
      .then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys()
      .then(function(names){
        return Promise.all(
          names
            .filter(function(name){ return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME; })
            .map(function(name){ return caches.delete(name); })
        );
      })
      .then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event){
  var req = event.request;
  if(req.method !== "GET") return; // never intercept writes/other methods

  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(url.origin !== self.location.origin) return; // no external network dependency

  event.respondWith(
    fetch(req)
      .then(function(networkResponse){
        var copy = networkResponse.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(req, copy); }).catch(function(){});
        return networkResponse;
      })
      .catch(function(){
        return caches.match(req).then(function(cached){
          if(cached) return cached;
          // Offline + not cached yet: for a page navigation, fall back to
          // the cached shell rather than a hard network error.
          if(req.mode === "navigate") return caches.match("./index.html");
          return Promise.reject(new Error("offline and not cached: " + req.url));
        });
      })
  );
});
