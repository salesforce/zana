import {expect,it,vi} from 'vitest';
import {ProductHttpClient} from './http.js';import {preflight} from './harness.js';
const fixture=(hosts:unknown[],explicit=false)=>{
 const fetchImpl=vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(String(input));
  if(url.pathname.endsWith('/hosts'))return Response.json(hosts);
  if(!url.searchParams.has('hostId'))return Response.json({error:'ambiguous-host: hostId is required when more than one host is connected'},{status:400});
  return Response.json({results:[{family:'codex',installed:true,enabled:true}]});
 });return {fetchImpl,http:new ProductHttpClient('http://localhost',{fetchImpl})};
};
it('selects the registered primary host after an ambiguous default probe',async()=>{
 const {http,fetchImpl}=fixture([{id:'remote',isPrimary:false,status:'connected'},{id:'primary',isPrimary:true,status:'connected'}]);
 expect(await preflight(http,{surface:'thread',providerId:'codex'})).toMatchObject({family:'codex'});expect(String(fetchImpl.mock.calls[2][0])).toContain('hostId=primary');
});
it('honors an explicit host and fails closed without a primary',async()=>{
 const {http,fetchImpl}=fixture([{id:'remote',status:'connected'}]);await expect(preflight(http,{surface:'thread',providerId:'codex'})).rejects.toThrow('ambiguous');
 fetchImpl.mockClear();await preflight(http,{surface:'thread',providerId:'codex',hostId:'remote'});expect(fetchImpl).toHaveBeenCalledTimes(1);expect(String(fetchImpl.mock.calls[0][0])).toContain('hostId=remote');
});
