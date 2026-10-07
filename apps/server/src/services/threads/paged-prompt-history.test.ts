import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, upsertHost, setConversationProviderThreadId, createEnvironment, createConversationThread, archiveConversationThread, appendConversationThreadEvent, type ZccDatabase } from '@zana-ai/zcc-db';
import { pagedConversationPromptHistory } from './conversation-prompt-history.js';
import {formatUserPromptHistoryRows,userPromptHistoryQuery} from '@zana-ai/zcc-db';

let db: ZccDatabase;
let dir: string;
let hostId: string;
let environmentId: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'history-db-'));
  db = openDatabase(join(dir, 'test.sqlite'));
  hostId = upsertHost(db, { name: 'test', hostKeyHash: 'h'.repeat(64) }).id;
  environmentId = createEnvironment(db, { projectId: 'p', hostId, path: dir, workspaceProvisionType: 'unmanaged', status: 'ready' }).id;
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const create = (title = 'A conversation', projectId = 'p', visibility: 'visible' | 'hidden' = 'visible') => {
  const thread = createConversationThread(db, { projectId, hostId, environmentId, providerId: 'codex', title, visibility });
  setConversationProviderThreadId(db, thread.id, 'native');
  return thread;
};


it('paginates thread, project and all scopes with provenance and no duplicate accepted turns',async()=>{
 const thread=create(); const other=create('Other','other'); const hidden=create('Hidden','p','hidden');
 for(let i=0;i<34;i++) appendConversationThreadEvent(db,{threadId:thread.id,type:'client/turn/requested',payload:{input:[{type:'text',text:'prompt '+i,mentions:[]},{type:'localFile',path:'uploaded.md'},{type:'localImage',path:'/tmp/local.png'}],initiator:'user'}});
 appendConversationThreadEvent(db,{threadId:thread.id,type:'turn/input/accepted',payload:{input:[{type:'text',text:'duplicate'}]}});
 for(const t of [other,hidden]) appendConversationThreadEvent(db,{threadId:t.id,type:'client/turn/requested',payload:{input:[{type:'text',text:'prompt'}]}});
 appendConversationThreadEvent(db,{threadId:thread.id,type:'client/turn/requested',payload:{initiator:'agent',input:[{type:'text',text:'agent'}]}});
 const first=await pagedConversationPromptHistory({db},{scope:'thread',threadId:thread.id});
 expect(first.entries).toHaveLength(30);expect(first.nextCursor).toBeTruthy();expect(first.entries[0].input[1]).toMatchObject({sourceProjectId:'p'});expect(first.entries[0].input[2]).toMatchObject({hostId});
 const last=await pagedConversationPromptHistory({db},{scope:'thread',threadId:thread.id,cursor:first.nextCursor!});expect(last.entries).toHaveLength(4);expect(last.nextCursor).toBeNull();
 expect(new Set([...first.entries,...last.entries].map(row=>row.id)).size).toBe(34);
 expect((await pagedConversationPromptHistory({db},{scope:'project',projectId:'other'})).entries).toHaveLength(1);
 expect((await pagedConversationPromptHistory({db},{scope:'all',query:'prompt 33'})).entries).toHaveLength(1);
 expect((await pagedConversationPromptHistory({db},{scope:'all',query:'agent'})).entries).toHaveLength(0);
});
it('validates scopes and cursors and bounds row bytes',async()=>{
 for(const request of [{scope:'thread' as const},{scope:'project' as const},{scope:'all' as const,cursor:'broken'},{scope:'all' as const,cursor:Buffer.from('[1,2]').toString('base64url')},{scope:'thread' as const,threadId:'missing'}]) await expect(pagedConversationPromptHistory({db},request)).rejects.toThrow();
 expect(userPromptHistoryQuery({limit:Infinity}).limit).toBe(50);expect(userPromptHistoryQuery({limit:0}).limit).toBe(30);
 const row={id:'a',threadId:'t',projectId:'p',hostId:'h',sequence:1,createdAt:1,payload:JSON.stringify({input:'x'.repeat(1100000)})};
 expect(formatUserPromptHistoryRows([row,{...row,id:'b'}],30)).toMatchObject({next:{id:'a'}});
});
