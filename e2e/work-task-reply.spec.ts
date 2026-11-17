import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test, expect } from './fixtures/app.js';
import { buildPlugin } from '../packages/plugin-build/src/build-plugin.js';

const work=resolve(process.env.WORK_PLUGIN_ROOT || '../extensions/vpe-machines');
const taskId='zana-vpe-'+'a'.repeat(32);
test.use({initialConfig:{sponsorPromptDismissed:true},launchEnv:{ZCC_FAKE_PROVIDER:'1'},isolateBundledCatalog:true});
test.beforeEach(async({home})=>{
  if(!existsSync(join(work,'work/src/task-replies.ts')))return;
  const root=join(home,'work-fixture');mkdirSync(root,{recursive:true});
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'zcc-plugin-vpe-machines',version:'0.1.0',type:'module',engines:{zcc:'>=1.0.0',zccPluginSdk:'>=0.1.0'},zcc:{name:'Work',description:'Isolated task replies',branding:{icon:'Waypoints'},server:'./server.ts',app:'./app.tsx'}}));
  writeFileSync(join(root,'app.tsx'),readFileSync(join(work,'app.tsx'),'utf8').replaceAll("from './",`from '${work}/`).replaceAll("import './",`import '${work}/`));
  writeFileSync(join(root,'server.ts'),`
    import {registerTaskReplies} from '${work}/work/src/task-replies.ts';
    export default function(zcc){
      let run,spawns=0,sends=0,lastSpawn;const spawn=zcc.sdk.threads.spawn.bind(zcc.sdk.threads),send=zcc.sdk.threads.send.bind(zcc.sdk.threads);
      // Exercise the actual host thread APIs while forcing only the in-process fake
      // provider. Assert production's harness request; never resolve a real CLI.
      zcc.sdk.threads.spawn=async args=>{spawns++;lastSpawn=args;return spawn({...args,providerId:'fake'});};
      zcc.sdk.threads.send=async args=>{sends++;return send(args);};
      const tasks={taskRecord:async(projectId,taskId)=>{if(run?.projectId!==projectId||run?.taskId!==taskId)throw Error('Task owner mismatch');return run;},taskInstructions:async()=> 'Selected Chatter: model listener recursion. Selected attachment: investigation.txt. Original task: add a reentrancy guard.',taskArtifact:async(_p,_t,kind)=>kind==='logs'?'Result: reentrancy guard added. Verification: 3 regression tests passed.':'diff --git a/model.ts b/model.ts\\n+ if (updating) return;'};
      registerTaskReplies(zcc,tasks);
      zcc.rpc.method('fixtureConfigure',async({projectId,phase='finished'})=>{run={projectId,taskId:'${taskId}',title:'W-100 editor investigation',phase,detail:'Fixture state only',repoUrl:'https://example.com/team/repo',branch:'feature/editor',agent:'codex',size:'small',createdAt:Date.now(),updatedAt:Date.now()};await zcc.storage.kv.set('taskDraftsV1',[{updatedAt:Date.now(),source:{provider:'GUS',name:'W-100',title:'Editor recursion',url:'https://gus.example/ticket',snapshotAt:Date.now()},submission:{projectId,taskId:run.taskId}}]);});
      zcc.rpc.method('tasksSnapshot',async()=>({available:true,configured:true,approvalsAvailable:true,projects:await zcc.sdk.projects.list(),runs:run?[run]:[]}));
      zcc.rpc.method('taskRead',()=>run);zcc.rpc.method('taskResolve',()=>({state:'task',run}));zcc.rpc.method('taskArtifact',({kind})=>tasks.taskArtifact('','',kind));
      zcc.rpc.method('fixtureState',()=>({spawns,sends,lastSpawn}));
    }
  `);
  await buildPlugin(root,JSON.parse(readFileSync('package.json','utf8')).version);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));pkg.zcc.app='./app.js';pkg.zcc.server='./server.mjs';writeFileSync(join(root,'package.json'),JSON.stringify(pkg));
  const dir=join(home,'.zcc/plugins');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'installed.json'),JSON.stringify({version:1,plugins:[{id:'vpe-machines',version:'0.1.0',name:'Work',description:'Fixture task replies',icon:'Waypoints',enabled:true,status:'disabled',statusDetail:null,provenance:'direct',sourceKind:'path',source:'path:'+root,rootDir:root,serverEntry:'./server.mjs',appEntry:'./app.js',npmResolvedVersion:null,npmIntegrity:null,gitResolvedCommit:null,catalogMarketplace:null,catalogEntryId:null,installedAt:1,updatedAt:1}]}));
});

test('task replies create and reuse one real Zana thread through the fake provider',async({app,home},info)=>{
  test.skip(!existsSync(join(work,'work/src/task-replies.ts')),'Set WORK_PLUGIN_ROOT to the Work checkout');test.setTimeout(120000);
  const win=app.window;
  const rpc=(method:string,args:unknown={})=>win.evaluate(({method,args})=>window.cc.pluginApps.callRpc('vpe-machines',method,args),{method,args});
  await expect.poll(()=>win.evaluate(async()=>(await window.cc.pluginApps.list()).find(p=>p.id==='vpe-machines')?.status==='running'?'running':JSON.stringify((await window.cc.pluginApps.list()).find(p=>p.id==='vpe-machines')))).toBe('running');
  const path=join(home,'reply-project');mkdirSync(path);const projectId=await win.evaluate(async path=>{const r=await window.cc.projects.add(path);if(!r.ok)throw Error(r.message);return r.value.id;},path);
  await rpc('fixtureConfigure',{projectId});await win.getByRole('button',{name:'Work',exact:true}).click();await win.getByRole('button',{name:'History 1'}).click();
  await win.getByRole('button',{name:'Reply in thread',exact:true}).click();const composer=win.getByRole('region',{name:'Reply in thread'});await expect(composer.getByText('W-100',{exact:true})).toBeVisible();await expect(composer.getByRole('button',{name:'Start thread'})).toBeDisabled();expect(await rpc('fixtureState')).toMatchObject({spawns:0,sends:0});
  await composer.getByLabel('Your follow-up').fill('Review the regression test and explain the remaining risk.');await win.screenshot({path:info.outputPath('work-reply-composer.png')});await composer.getByRole('button',{name:'Start thread'}).click();
  await expect(win.getByTestId('thread-detail')).toBeVisible();
  const state=await rpc('fixtureState') as any;expect(state).toMatchObject({spawns:1,sends:0,lastSpawn:{projectId,harness:'project-default',visibility:'visible'}});
  for(const text of ['Selected Chatter','Selected attachment','3 regression tests passed','W-100','::task{project="'+projectId+'"','Review the regression test'])expect(state.lastSpawn.prompt).toContain(text);
  const link=await rpc('taskReplyLink',{projectId,taskId}) as any;expect(link.threadId).toBeTruthy();await expect.poll(()=>win.url()).toContain(link.threadId);
  const thread=await win.evaluate(async id=>(await(await fetch('/api/v1/threads/'+id)).json()).thread,link.threadId);expect(thread).toMatchObject({providerId:'fake',projectId,visibility:'visible',originPluginId:'vpe-machines'});
  await win.getByRole('button',{name:'Work',exact:true}).click();await win.getByRole('button',{name:'History 1'}).click();await expect(win.getByRole('button',{name:'Open thread',exact:true})).toBeVisible();
  await win.getByRole('button',{name:'Reply in thread',exact:true}).click();await composer.getByLabel('Your follow-up').fill('Explain the guard in plain language.');await composer.getByRole('button',{name:'Reply in thread',exact:true}).click();await expect.poll(()=>win.url()).toContain(link.threadId);expect(await rpc('fixtureState')).toMatchObject({spawns:1,sends:1});
  // Running and removed tasks retain the composer; reading never spawns a worker.
  for(const phase of ['running','failed','removed']){
    await rpc('fixtureConfigure',{projectId,phase});await win.getByRole('button',{name:'Work',exact:true}).click();if(phase==='removed')await win.getByRole('button',{name:'History 1'}).click();
    const button=win.getByRole('button',{name:'Reply in thread',exact:true});await expect(button).toBeVisible();await button.click();await expect(composer.getByLabel('Your follow-up')).toBeVisible();await composer.getByRole('button',{name:'Close reply'}).click();
  }
  expect(await rpc('fixtureState')).toMatchObject({spawns:1,sends:1});
});
