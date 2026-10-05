import {createHash} from 'node:crypto';
import {NativeError,exactRequestDigest,sameVersion,validateValue,version} from '../vendor/semwright-native-sdk/index.mjs';
import {closed,id,str,validateDocument} from './contracts.mjs';
import {assertUnlocked,clone} from './model.mjs';

const json=JSON.stringify;
const hash=value=>createHash('sha256').update(value).digest('hex');
const ALLOWED=new Set(['image/png','image/jpeg','image/webp','audio/wav','audio/mpeg','video/mp4']);

function need(value,message,code='InvalidArgument'){if(!value)throw new NativeError(code,message);}
function validMagic(b,m){switch(m){case 'image/png':return b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));case 'image/jpeg':return b[0]===255&&b[1]===216&&b[2]===255;case 'image/webp':return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';case 'audio/wav':return b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE';case 'audio/mpeg':return b.toString('ascii',0,3)==='ID3'||(b[0]===255&&(b[1]&224)===224);case 'video/mp4':return b.toString('ascii',4,8)==='ftyp';default:return false;}}

export function attachAssetBytes(store,resource,rawExpected,key,rawAsset,rawBytes,mime){
 need(!store.readOnly,'Read-only application instance','PermissionDenied');str(resource,128);str(key,128);const expected=version(rawExpected);need(expected.resource===resource,'Target binding differs','Conflict');
 const assetInput=closed(rawAsset,['id','name','license','provenance'],['id','name','license','provenance']);id(assetInput.id);str(assetInput.name,240);str(assetInput.license,200);str(assetInput.provenance,2000);
 const bytes=Buffer.from(rawBytes);need(bytes.length>0&&bytes.length<=16*1024*1024,'Media exceeds the 16 MiB local project budget','ResourceExhausted');need(ALLOWED.has(mime),'Unsupported media type');need(validMagic(bytes,mime),'Media content does not match declared type');
 const digest=hash(bytes),asset={...clone(assetInput),sha256:digest,mime,bytes:bytes.length};const parameters={asset,blob:{sha256:digest,mime,bytes:bytes.length,transport:'local-binary'}};
 const request_sha256=exactRequestDigest('sequencewright/local-asset-upload/1',{operation:'asset.upload',expected,epoch:1,key,parameters});const identity={resource,epoch:1,key,request_sha256};validateValue(parameters);
 let commitAttempted=false;store.db.exec('BEGIN IMMEDIATE');
 try{
  const before=store.current(resource),recorded=store.lookup(identity);if(recorded.state==='recorded'){store.db.exec('ROLLBACK');return {...recorded.result,replayed:true,historical_only:true};}
  need(sameVersion(expected,before.version),'This revision changed. Reload and review the conflict before applying.','StaleReference');const doc=clone(before.document);assertUnlocked(doc,doc.locks.map(l=>l.scope),store.actor);need(!doc.assets.some(a=>a.id===asset.id),'Asset id exists','Conflict');doc.assets.push(asset);validateDocument(doc);
  store.db.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?,?)').run(digest,mime,bytes);const after=store.writeRevision(resource,doc,[before.version.revision],'asset.upload');
  const result={version:after,previous:before.version,documentDigest:hash(json(doc)),metadata:{asset},replayed:false,historical_only:false};validateValue(result);store.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(resource,1,key,request_sha256,json(result));
  commitAttempted=true;store.db.exec('COMMIT');return result;
 }catch(error){try{store.db.exec('ROLLBACK');}catch{}if(commitAttempted)throw new NativeError('BackendFailed','Commit outcome unknown; recover using the exact request identity',false);throw error;}
}
