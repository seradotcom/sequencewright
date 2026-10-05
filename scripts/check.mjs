import {readdirSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=[];for(const dir of ['src','public','scripts','tests'])for(const f of readdirSync(dir))if(f.endsWith('.mjs'))files.push(`${dir}/${f}`);
for(const f of files){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});if(r.status){console.error(r.stderr);process.exit(1);}}
console.log(`${files.length} JavaScript modules passed syntax checking`);
