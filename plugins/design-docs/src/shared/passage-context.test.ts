import {expect,it} from 'vitest';
import {passageContext} from './passage-context.js';
it('keeps exact text and descriptive plugin locations without invented source lines',()=>{
 expect(passageContext('doc','chapters/intro.md','  exact\ntext')).toEqual({version:1,label:'intro.md (selection)',text:'  exact\ntext',source:{kind:'plugin',pluginId:'design-docs',resourceId:'doc',path:'chapters/intro.md'}});
 expect(passageContext('doc','folder/','text').label).toBe('folder/ (selection)');
});
