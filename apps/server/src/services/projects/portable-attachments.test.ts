import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {normalizePortableAttachments} from './portable-attachments.js';
import {storeAttachment,resolveStoredAttachmentPath} from './attachments.js';
import type {ProductHttpContext} from '../../http/product-context.js';
let dir:string;let ctx:Pick<ProductHttpContext,'dataDir'|'toProjects'>;
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'portable-'));ctx={dataDir:dir,toProjects:()=>[{id:'source'},{id:'target'}] as never};});afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
const upload=async(name='image',type='image/png')=>storeAttachment(dir,'source',{name,type,size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer});
it('copies uploads, preserves image identity and metadata, deduplicates, and survives source deletion',async()=>{
 const source=await upload();const part={...source,sourceProjectId:'source'};
 const result=await normalizePortableAttachments(ctx,[part,part,{type:'text',text:'hello',mentions:[]}],'target','h') as Array<typeof source>;
 expect(result[0].type).toBe('localImage');expect(result[0].name).toBe('image');expect(result[0].mimeType).toBe('image/png');expect(result[0].path).toBe(result[1].path);expect(result[0]).not.toHaveProperty('sourceProjectId');
 await rm(join(dir,'attachments','source'),{recursive:true});expect([...await readFile(resolveStoredAttachmentPath(dir,'target',result[0].path))]).toEqual([1,2,3]);
});
it('rejects unknown projects, traversal, symlink escapes, cross-host absolute files and mixed provenance',async()=>{
 const source=await upload('file.txt','text/plain');const outside=join(dir,'outside');await writeFile(outside,'secret');await symlink(outside,join(dir,'attachments','source','link'));
 for(const part of [{...source,sourceProjectId:'missing'},{...source,path:'../outside',sourceProjectId:'source'},{...source,path:'link',sourceProjectId:'source'},{type:'localImage',path:'/tmp/image.png',hostId:'other'},{type:'localImage',path:'/tmp/image.png',sourceProjectId:'source'},{...source,hostId:'h'}]) await expect(normalizePortableAttachments(ctx,[part],'target','h')).rejects.toThrow();
});
it('keeps same-project and same-host attachments and non-attachments unchanged, stripping provenance',async()=>{
 expect(await normalizePortableAttachments(ctx,'legacy','target','h')).toBe('legacy');
 const result=await normalizePortableAttachments(ctx,[{type:'localFile',path:'file.txt',sourceProjectId:'target'},{type:'localImage',path:'/tmp/image.png',hostId:'h'},{type:'text',text:'x',mentions:[]},'legacy'],'target','h');
 expect(result).toEqual([{type:'localFile',path:'file.txt'},{type:'localImage',path:'/tmp/image.png'},{type:'text',text:'x',mentions:[]},'legacy']);
});
it('removes partial copies when a later attachment fails',async()=>{
 const source=await upload();await expect(normalizePortableAttachments(ctx,[{...source,sourceProjectId:'source'},{...source,path:'missing',sourceProjectId:'source'}],'target','h')).rejects.toThrow();
 const {readdir}=await import('node:fs/promises');expect(await readdir(join(dir,'attachments','target'))).toEqual([]);
});
