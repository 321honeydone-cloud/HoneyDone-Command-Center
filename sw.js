const CACHE='honeydone-v3';
const ASSETS=['/','/index.html','/manifest.json','/icon-192.png','/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS).catch(()=>{})));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(['api.anthropic.com','api.getjobber.com','script.google.com','maps.google.com','homedepot.com'].some(h=>e.request.url.includes(h)))return;
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{const c=res.clone();caches.open(CACHE).then(ca=>ca.put(e.request,c));return res;}).catch(()=>caches.match('/'))));
});