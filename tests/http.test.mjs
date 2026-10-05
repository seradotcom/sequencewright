import {request as httpRequest} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStudio} from '../src/server.mjs';

async function fixture(t){
 const studio=createStudio({root:mkdtempSync(join(tmpdir(),'sequencewright-http-')),port:0});
 const port=await studio.listen();t.after(()=>studio.close());
 const base=`http://127.0.0.1:${port}`;const session=await fetch(base+'/api/session');const {csrf}=await session.json();const cookie=session.headers.get('set-cookie').split(';')[0];
 const request=(body,headers={})=>fetch(base+'/api/call',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie,'X-Sequencewright-CSRF':csrf,...headers},body:JSON.stringify(body)});
 const call=async(operation,parameters={},expected=null,key=crypto.randomUUID())=>{const r=await request({operation,parameters,expected,key});return {status:r.status,...await r.json()};};
 return {studio,base,request,call,cookie,csrf};
}
test('HTTP serves only the explicitly mapped studio files',async t=>{const f=await fixture(t);assert.equal((await fetch(f.base)).status,200);assert.equal((await fetch(f.base+'/src/store.mjs')).status,404);assert.equal((await fetch(f.base+'/package.json')).status,404);const h=(await fetch(f.base)).headers;assert.match(h.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(h.get('x-content-type-options'),'nosniff');});
test('writes require both the local session and anti-CSRF token',async t=>{const f=await fixture(t);assert.equal((await f.request({operation:'project.list'},{Cookie:''})).status,403);assert.equal((await f.request({operation:'project.list'},{'X-Sequencewright-CSRF':''})).status,403);assert.equal((await f.request({operation:'project.list'},{Origin:'https://untrusted.invalid'})).status,403);});
test('foreign Host and cross-site bootstrap are denied',async t=>{const f=await fixture(t);assert.equal(await new Promise((resolve,reject)=>{const r=httpRequest(f.base+'/health',{headers:{Host:'unexpected.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();}),403);assert.equal((await fetch(f.base+'/api/session',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);});
test('HTTP editing uses the same exact-version transaction as native operations',async t=>{const f=await fixture(t);const a=await f.call('document.read',{resource:'demo-product@main'});assert.equal(a.status,200);const b=await f.call('document.edit',{title:'A revised story'},a.data.version,'http-edit');assert.equal(b.status,200);assert.equal((await f.call('document.read',{resource:'demo-product@main'})).data.document.title,'A revised story');const old=await f.call('document.edit',{title:'stale'},a.data.version,'http-stale');assert.equal(old.status,409);const replay=await f.call('document.edit',{title:'A revised story'},a.data.version,'http-edit');assert.equal(replay.data.replayed,true);});
test('unknown and source-bearing inputs do not become executable operations',async t=>{const f=await fixture(t);assert.equal((await f.call('execute.source',{source:'not a command'})).status,422);assert.equal((await f.request({operation:'project.list',source:'extra'})).status,400);const r=await f.call('document.read',{resource:'demo-product@main'});assert.equal((await f.call('document.edit',{source:'extra'},r.data.version)).status,400);});
test('read-only Film and subtitle exports are explicit about native validation',async t=>{const f=await fixture(t);const film=await f.call('document.export',{resource:'demo-product@main',format:'film'});assert.equal(film.data.validation,'REQUIRES_CANONICAL_COMPILER');assert.equal(film.data.film.sequences.length,4);const cap=await f.call('document.export',{resource:'demo-product@main',format:'vtt'});assert.match(cap.data.text,/WEBVTT/);const c=await f.call('capabilities.read');assert.equal(c.data.preview.native,false);assert.ok(c.data.renderers.every(x=>x.status==='NOT_CONNECTED'));});
