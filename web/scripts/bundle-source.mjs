import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
fs.mkdirSync('public/downloads',{recursive:true});fs.mkdirSync('public/docs',{recursive:true});
for(const file of ['README.md','PROTOCOL.md','TESTING.md','DEPLOYMENT.md','UPDATES.md','LATENCY.md'])fs.copyFileSync(file==='README.md'?file:`docs/${file}`,`public/docs/${file}`);
const target='public/downloads/SMART_sEMG_TRAINER_source.zip';
if(fs.existsSync(target))fs.unlinkSync(target);
const code=`import pathlib,zipfile
root=pathlib.Path('.')
with zipfile.ZipFile('${target}','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob('*')):
        if not p.is_file() or any(x in {'.git','node_modules','dist','.openai','.sites-runtime','downloads'} for x in p.parts): continue
        if p.name in {'.env','.env.local'} or p.suffix in {'.log','.tsbuildinfo'} or p.name.startswith('.env.') and p.name!='.env.example': continue
        z.write(p,pathlib.Path('web')/p)
`;
execFileSync('python3',['-c',code],{stdio:'inherit'});console.log(`Source bundle: ${target} (${fs.statSync(target).size} bytes)`);

const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const versioned=`public/downloads/SMART_sEMG_TRAINER_v${version}.zip`;fs.copyFileSync(target,versioned);console.log(`Versioned source: ${versioned}`);
