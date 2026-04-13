const C='chess-v4';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','/index.html','/manifest.json','/icon.svg'])));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.url.startsWith('ws')||e.request.url.startsWith('wss'))return;
  e.respondWith(caches.match(e.request).then(c=>{if(c)return c;return fetch(e.request).then(r=>{if(e.request.url.includes('fonts.g')){const cl=r.clone();caches.open(C).then(ca=>ca.put(e.request,cl));}return r;}).catch(()=>{if(e.request.mode==='navigate')return caches.match('/index.html');});}));
});