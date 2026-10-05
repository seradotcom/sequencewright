import {mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {MUTATIONS,READS} from '../src/contracts.mjs';
const string={type:'string',maxLength:12000},identifier={type:'string',maxLength:128,minLength:1},integer={type:'integer',minimum:0,maximum:9007199254740991};
const object=(properties={},required=[])=>({type:'object',properties,required,additionalProperties:false});
const array=items=>({type:'array',items,maxItems:512});
// Detailed value invariants remain enforced by the single application validator.
// Property vocabulary is closed here, before a Host-authorized operation is dispatched.
const jsonObject={type:'object',maxProperties:64};
const itemSchemas={
 'document.edit':object({title:string,description:string,profile:jsonObject}),
 'scene.add':object({scene:jsonObject,afterId:{type:['string','null']}},['scene']),
 'scene.update':object({sceneId:identifier,changes:jsonObject},['sceneId','changes']),
 'scene.reorder':object({order:array(identifier)},['order']),
 'scene.archive':object({sceneId:identifier,archived:{type:'boolean'}},['sceneId','archived']),
 'object.add':object({sceneId:identifier,object:jsonObject},['sceneId','object']),
 'object.update':object({sceneId:identifier,objectId:identifier,changes:jsonObject},['sceneId','objectId','changes']),
 'object.archive':object({sceneId:identifier,objectId:identifier,archived:{type:'boolean'}},['sceneId','objectId','archived']),
 'keyframe.set':object({sceneId:identifier,objectId:identifier,keyframe:jsonObject},['sceneId','objectId','keyframe']),
 'keyframe.remove':object({sceneId:identifier,objectId:identifier,frame:integer,property:identifier},['sceneId','objectId','frame','property']),
 'caption.set':object({caption:jsonObject},['caption']),
 'caption.remove':object({captionId:identifier},['captionId']),
 'brief.update':object(Object.fromEntries(['audience','objective','promise','tone','constraints','references'].map(k=>[k,string]))),
 'lock.set':object({scope:identifier,reason:string},['scope','reason']),
 'lock.release':object({scope:identifier},['scope']),
 'proposal.create':object({id:identifier,title:string,rationale:string,scope:identifier,changes:array(jsonObject),provider:string,constraints:array(string)},['id','title','rationale','scope','changes','provider','constraints']),
 'proposal.apply':object({proposalId:identifier},['proposalId']),
 'proposal.reject':object({proposalId:identifier},['proposalId']),
 'branch.fork':object({name:identifier},['name']),
 'branch.merge':object({source:identifier,sourceVersion:jsonObject,resolutions:jsonObject},['source','sourceVersion','resolutions']),
 'history.restore':object({revision:identifier},['revision']),
 'review.add':object({id:identifier,sceneId:identifier,objectId:{type:['string','null']},frame:integer,text:string,category:identifier},['id','sceneId','frame','text','category']),
 'review.resolve':object({reviewId:identifier,resolved:{type:'boolean'}},['reviewId','resolved']),
 'asset.attach':object({asset:jsonObject,blob:jsonObject},['asset','blob']),
 'delivery.profile':object({id:identifier,name:string,width:integer,height:integer,captions:{type:'boolean'},language:identifier},['id','name','width','height','captions','language']),
 'project.create':object({title:string,template:{enum:['product','lesson','brand']}},['title']),
 'project.import':object({document:jsonObject,blobs:array(jsonObject)},['document']),
};
const readFields={
 'document.read':{revision:identifier},'history.list':{limit:{type:'integer',minimum:1,maximum:100},offset:integer},'branch.list':{},'branch.compare':{other:identifier},'proposal.list':{},'review.list':{},'project.list':{},'document.export':{format:{enum:['archive','film','srt','vtt']}},'context.read':{sceneId:identifier,objectId:identifier},'capabilities.read':{}
};
export function emitContracts(){
 const request=object({resource:identifier,epoch:integer,key:identifier,request_sha256:{type:'string',pattern:'^[0-9a-f]{64}$'}},['resource','epoch','key','request_sha256']);
 const specs=[...MUTATIONS.map(name=>{const suffix=name.slice('driver.sequencewright.'.length);if(!itemSchemas[suffix])throw new Error('Missing schema '+suffix);return {name,mutation:true,input:object({ref:identifier,request,parameters:itemSchemas[suffix]},['ref','request','parameters'])};}),...READS.map(name=>{const suffix=name.slice('driver.sequencewright.'.length);return {name,mutation:false,input:object({ref:identifier,resource:identifier,...readFields[suffix]},['ref',...(suffix==='branch.compare'?['other']:[])])};})];
 mkdirSync('contracts',{recursive:true});writeFileSync('contracts/native-operations.json',JSON.stringify(specs,null,2)+'\n');return specs;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)emitContracts();
