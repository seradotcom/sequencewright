import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Store,envelope,capabilities} from './store.mjs';
import {attachAssetBytes} from './local-assets.mjs';
import {NativeError,applicationContext,dispatchApplication,validateValue} from '../vendor/semwright-native-sdk/index.mjs';
import {NAMESPACE,MUTATIONS,READS} from './contracts.mjs';
const here=dirname(fileURLToPath(import.meta.url));
const staticFiles=new Map([['/','index.html'],['/app.mjs','app.mjs'],['/style.css','style.css'],['/render.mjs','render.mjs'],['/icon.svg','icon.svg']]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
export function createStudio({root=process.env.SEQUENCEWRIGHT_DATA??'.data',port=Number(process.env.PORT??4318),seed=true}={}){
 const store=new Store(root,{seed,actor:'local-editor'});const csrf=randomBytes(32).toString('hex');const session=randomBytes(32).toString('hex');
 const app=store.application();let closing=false;
 function send(res,status,data,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8',...headers});res.end(typeof data==='string'?data:JSON.stringify(data));}
 function requireCsrf(req){const supplied=Buffer.from(String(req.headers['x-sequencewright-csrf']??'')),expected=Buffer.from(csrf);if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw new NativeError('PermissionDenied','Missing session CSRF token');}
 const server=createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
  try{
   const host=req.headers.host??'';const allowed=new Set([`127.0.0.1:${server.address()?.port}`,`localhost:${server.address()?.port}`]);if(!allowed.has(host))throw new NativeError('PermissionDenied','Host header not allowed');
   const url=new URL(req.url,'http://'+host);if(req.headers.origin&&req.headers.origin!=='http://'+host)throw new NativeError('PermissionDenied','Cross-origin request refused');
   const hasSession=req.headers.cookie?.split(';').some(x=>x.trim()===`sequencewright=${session}`);
   if(req.method==='GET'&&url.pathname==='/api/session'){
    const origin=req.headers['sec-fetch-site'];if(origin&&origin!=='same-origin'&&origin!=='none')throw new NativeError('PermissionDenied','Open the studio directly on loopback');
    send(res,200,{csrf,actor:'local-editor',capabilities:capabilities()},{'Set-Cookie':`sequencewright=${session}; HttpOnly; SameSite=Strict; Path=/`});return;
   }
   if(req.method==='GET'&&staticFiles.has(url.pathname)){
    const name=staticFiles.get(url.pathname),ext=name.slice(name.lastIndexOf('.'));const data=await readFile(join(here,'../public',name));res.writeHead(200,{'content-type':types[ext]});res.end(data);return;
   }
   if(req.method==='GET'&&url.pathname==='/health'){send(res,200,{status:'ok',application:'sequencewright',schema:1});return;}
   if(url.pathname.startsWith('/api/')&&!hasSession)throw new NativeError('PermissionDenied','Open a local studio session first');
   if(req.method==='GET'&&url.pathname==='/api/blob'){
    const b=store.blob(url.searchParams.get('sha256'),url.searchParams.get('resource'));res.writeHead(200,{'content-type':b.mime,'content-length':b.data.byteLength,'Accept-Ranges':'none'});res.end(Buffer.from(b.data));return;
   }
   if(req.method==='GET'&&url.pathname==='/api/events'){
    const resource=url.searchParams.get('resource');const cursor=Number(url.searchParams.get('after')??0);if(!Number.isSafeInteger(cursor)||cursor<0)throw new NativeError('InvalidArgument','Invalid event cursor');store.current(resource);const items=store.db.prepare('SELECT * FROM events WHERE resource=? AND seq>? ORDER BY seq LIMIT 100').all(resource,cursor);send(res,200,{items,next:items.at(-1)?.seq??cursor,historical_hints_only:true});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/assets'){
    requireCsrf(req);const header=String(req.headers['x-sequencewright-asset']??'');if(!header||Buffer.byteLength(header)>12000)throw new NativeError('InvalidArgument','Asset metadata header is missing or too large');
    let metadata;try{metadata=JSON.parse(decodeURIComponent(header));}catch{throw new NativeError('InvalidArgument','Malformed asset metadata');}validateValue(metadata);
    if(!metadata||typeof metadata!=='object'||Array.isArray(metadata)||!Object.keys(metadata).every(k=>['resource','expected','key','asset'].includes(k))||!['resource','expected','key','asset'].every(k=>Object.hasOwn(metadata,k)))throw new NativeError('InvalidArgument','Invalid asset upload envelope');
    const mime=String(req.headers['content-type']??'').split(';',1)[0].trim().toLowerCase();if(!['image/png','image/jpeg','image/webp','audio/wav','audio/mpeg','video/mp4'].includes(mime))throw new NativeError('InvalidArgument','Unsupported asset Content-Type');
    const declared=Number(req.headers['content-length']??0);if(declared&&(!Number.isSafeInteger(declared)||declared<1||declared>16*1024*1024))throw new NativeError('ResourceExhausted','Asset exceeds the 16 MiB local project budget');
    let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>16*1024*1024)throw new NativeError('ResourceExhausted','Asset exceeds the 16 MiB local project budget');parts.push(chunk);}if(size<1)throw new NativeError('InvalidArgument','Asset body is empty');
    const result=attachAssetBytes(store,metadata.resource,metadata.expected,metadata.key,metadata.asset,Buffer.concat(parts),mime);send(res,200,{ok:true,data:result});return;
   }
   if(req.method==='POST'&&url.pathname==='/api/call'){
    if(req.headers['content-type']!=='application/json')throw new NativeError('InvalidArgument','Content-Type must be application/json');requireCsrf(req);
    let size=0;const parts=[];for await(const chunk of req){size+=chunk.length;if(size>256*1024)throw new NativeError('ResourceExhausted','Request exceeds native transport budget');parts.push(chunk);}
    let raw;try{raw=JSON.parse(Buffer.concat(parts));}catch{throw new NativeError('InvalidArgument','Malformed JSON');}validateValue(raw);
    if(!raw||typeof raw.operation!=='string'||!Object.keys(raw).every(k=>['operation','expected','parameters','key','identity'].includes(k)))throw new NativeError('InvalidArgument','Invalid call envelope');
    const op=NAMESPACE+raw.operation;const context=applicationContext(raw.key??randomBytes(16).toString('hex'),raw.expected??null);
    let result;if(raw.operation==='request.lookup'){result=store.lookup(raw.identity);}else if(MUTATIONS.includes(op)){const args=envelope(op,context.expected,raw.parameters,context.requestId);result=await dispatchApplication(app,'invoke',op,args,context);}else if(READS.includes(op)){result=await dispatchApplication(app,'invoke',op,raw.parameters??{},context);}else throw new NativeError('Unsupported','Unknown typed operation');
    send(res,200,{ok:true,data:result});return;
   }
   send(res,404,{ok:false,error:{code:'NotFound',message:'Route not found'}});
  }catch(error){const e=error instanceof NativeError?error:new NativeError('BackendFailed','Application request failed; inspect local logs for details');if(!(error instanceof NativeError))console.error(error);const status={PermissionDenied:403,NotFound:404,Conflict:409,StaleReference:409,ResourceExhausted:413,Unsupported:422,InvalidArgument:400}[e.code]??500;if(!res.headersSent)send(res,status,{ok:false,error:e.record()});else res.end();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;
 return {server,store,listen:()=>new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve(server.address().port))),close:()=>new Promise((resolve,reject)=>{if(closing)return resolve();closing=true;server.close(e=>{store.close();e?reject(e):resolve();});server.closeIdleConnections();})};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){const studio=createStudio();const port=await studio.listen();console.log(`Sequencewright — http://127.0.0.1:${port}\nData: ${studio.store.root}\nLocal authoring; native rendering is not connected.`);for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>studio.close().then(()=>process.exit(0)));}
