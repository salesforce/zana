import {afterEach,expect,it} from 'vitest';
import {registerThreadProvider} from './thread-provider-catalog.js';
import {authorizedServiceTier} from './provider-service-tier.js';
import type {ProductHttpContext} from '../../http/product-context.js';
const cleanup:Array<()=>void>=[]; afterEach(()=>cleanup.splice(0).forEach(fn=>fn()));
const ctx=(disabled=false)=>({config:{getConfig:()=>({providerServiceTiersDisabled:disabled})}} as ProductHttpContext);
it('accepts declared tiers, legacy fast, default and omission and rejects malformed or undeclared tiers',()=>{
 const provider=registerThreadProvider('test',{id:'test',displayName:'Test',serviceTiers:[{id:'economy',label:'Economy'}],capabilities:{supportsServiceTier:true,fork:'none',permissionModes:['full'],reasoningLevels:[]}});cleanup.push(()=>provider.unregister());
 expect(authorizedServiceTier(ctx(),'test','economy')).toBe('economy');expect(authorizedServiceTier(ctx(),'test','default')).toBe('default');expect(authorizedServiceTier(ctx(),'test',undefined)).toBeUndefined();expect(authorizedServiceTier(ctx(),'test',null)).toBeUndefined();
 for(const tier of ['fast','unknown','bad tier','',23]) expect(()=>authorizedServiceTier(ctx(),'test',tier)).toThrow();
 expect(()=>authorizedServiceTier(ctx(true),'test','economy')).toThrow(/disabled/);expect(authorizedServiceTier(ctx(true),'test','default')).toBe('default');
 expect(()=>authorizedServiceTier(ctx(),'missing','fast')).toThrow();
});
it('keeps fast compatibility for older supporting declarations',()=>{
 const provider=registerThreadProvider('test',{id:'legacy',displayName:'Legacy',capabilities:{supportsServiceTier:true,fork:'none',permissionModes:['full'],reasoningLevels:[]}});cleanup.push(()=>provider.unregister());expect(authorizedServiceTier(ctx(),'legacy','fast')).toBe('fast');
});
it('preserves inherited legacy fast and suppresses inherited paid tiers when disabled',()=>{
 expect(authorizedServiceTier(ctx(),'missing','fast',{inherited:true})).toBe('fast');
 expect(authorizedServiceTier(ctx(true),'missing','fast',{inherited:true})).toBe('default');
 expect(()=>authorizedServiceTier(ctx(),'missing','economy',{inherited:true})).toThrow();
});
