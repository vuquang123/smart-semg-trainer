import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk('dist').filter(f=>!f.includes('/downloads/')&&!f.includes('/docs/')&&!f.endsWith('/sw.js'));
const hash=crypto.createHash('sha256');for(const f of files)hash.update(fs.readFileSync(f));
const cache=`semg-shell-${hash.digest('hex').slice(0,12)}`;
const precache=files.map(f=>'/'+f.replaceAll('\\','/').replace(/^dist\//,''));
fs.writeFileSync('dist/sw.js',`
const CACHE=${JSON.stringify(cache)};
const ASSETS=${JSON.stringify(precache)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('semg-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;const url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return;
 if(req.mode==='navigate'){
   event.respondWith(fetch(req).then(r=>r.ok?r:caches.match('/index.html').then(c=>c||r)).catch(()=>caches.match('/index.html').then(c=>c||caches.match('/offline.html'))));return;
 }
 if(ASSETS.includes(url.pathname))event.respondWith(caches.match(url.pathname).then(c=>c||fetch(req)));
});
`);
console.log(`PWA: ${precache.length} resources, cache ${cache}`);
