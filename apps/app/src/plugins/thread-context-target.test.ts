import {expect,it,vi} from 'vitest';
import {addThreadContext,registerThreadContextTarget} from './thread-context-target.js';
it('inserts only into one mounted owning thread and releases on shutdown',()=>{
 const ref={version:1 as const,label:'Log',text:'exact'}; const insert=vi.fn(()=>true), other=vi.fn(()=>true);
 expect(addThreadContext('a',ref)).toBe(false);
 const release=registerThreadContextTarget('a',insert), releaseOther=registerThreadContextTarget('b',other);
 expect(addThreadContext('a',ref)).toBe(true);expect(other).not.toHaveBeenCalled();
 expect(addThreadContext(null,ref)).toBe(false);expect(addThreadContext('a',{...ref,version:2} as never)).toBe(false);
 const ambiguous=registerThreadContextTarget('a',other);expect(addThreadContext('a',ref)).toBe(false);
 ambiguous();expect(addThreadContext('a',ref)).toBe(true);release();releaseOther();expect(addThreadContext('a',ref)).toBe(false);
});
