import test from 'node:test';
import assert from 'node:assert/strict';
import './timeline.js';
const {stateAt,cursorAt,typed,chapters,DURATION,prompt,pluginPrompt,moves}=globalThis.DemoTimeline;

test('clock clamps negative, non-finite and out-of-range input',()=>{
  for(const t of [-100,NaN,Infinity,undefined])assert.equal(stateAt(t).t,0);
  assert.equal(stateAt(500).t,DURATION);
  assert.equal(cursorAt(NaN).visible,false);
  assert.equal(cursorAt(500).visible,false);
});
test('typing reveals a prefix and completes exactly at its deadline',()=>{
  assert.equal(typed('abcd',0,1,3),'');
  assert.equal(typed('abcd',2,1,3),'ab');
  assert.equal(typed('abcd',8,1,3),'abcd');
  assert.equal(stateAt(34.7).prompt,prompt);
  assert.equal(stateAt(135).pluginPrompt,pluginPrompt);
});
test('project exists only after confirmation',()=>{
  assert.equal(stateAt(8.5).modal,'project-menu');
  assert.equal(stateAt(11).modal,'add-project');
  assert.equal(stateAt(19.49).projectCreated,false);
  assert.equal(stateAt(19.5).projectCreated,true);
  assert.equal(stateAt(19.5).modal,null);
});
test('launch does not expose sent work before Send',()=>{
  assert.equal(stateAt(23).view,'compose');
  assert.equal(stateAt(25).modal,'provider');
  assert.equal(stateAt(27.3).provider,'Codex');
  assert.equal(stateAt(35.99).sent,false);
  assert.equal(stateAt(36).view,'thread');
  assert.equal(stateAt(36).sent,true);
});
test('agent waits for a submitted answer and becomes Idle only after checks',()=>{
  assert.equal(stateAt(46).view,'board');
  assert.equal(stateAt(50.49).status,'Working');
  assert.equal(stateAt(50.5).status,'Needs you');
  assert.equal(stateAt(55).answerSelected,true);
  assert.equal(stateAt(55).answerSent,false);
  assert.equal(stateAt(57.5).answerSent,true);
  assert.equal(stateAt(57.5).status,'Working');
  assert.equal(stateAt(67.99).passed,false);
  assert.equal(stateAt(68).passed,true);
  assert.equal(stateAt(70).status,'Idle');
  assert.equal(stateAt(79).view,'board');
});
test('GUS filters, watch and agent handoff are separate actions',()=>{
  assert.equal(stateAt(85).me,false);
  assert.equal(stateAt(89).me,true);
  assert.equal(stateAt(89).sprint,false);
  assert.equal(stateAt(92).sprint,true);
  assert.equal(stateAt(94).modal,'ticket');
  assert.equal(stateAt(94).watching,false);
  assert.equal(stateAt(97).watching,true);
  assert.equal(stateAt(101).chatter,true);
  assert.equal(stateAt(107).view,'ticket-compose');
  assert.equal(stateAt(107).modal,null);
  assert.equal(stateAt(113).view,'ticket-thread');
});
test('plugin remains uninstalled through build and review',()=>{
  assert.equal(stateAt(119).view,'plugins');
  assert.equal(stateAt(125).view,'plugin-compose');
  assert.equal(stateAt(137).view,'plugin-thread');
  assert.equal(stateAt(150).pluginTested,true);
  assert.equal(stateAt(154).modal,'install');
  assert.equal(stateAt(158.49).installed,false);
  assert.equal(stateAt(158.5).installed,true);
  assert.equal(stateAt(161).view,'focus');
});
test('scripted plugin has coherent counts and resets on rewind',()=>{
  assert.deepEqual(stateAt(161).focusChecked,[false,false,false]);
  assert.deepEqual(stateAt(164.5).focusChecked,[true,false,false]);
  assert.deepEqual(stateAt(168).focusChecked,[true,true,false]);
  assert.equal(stateAt(173.9).focusAdded,false);
  assert.equal(stateAt(174).focusAdded,true);
  assert.deepEqual(stateAt(161).focusChecked,[false,false,false]);
});
test('chapter lookup and full replay are deterministic',()=>{
  const trace=Array.from({length:761},(_,i)=>stateAt(i/4));
  for(let i=trace.length-1;i>=0;i--)assert.deepEqual(stateAt(i/4),trace[i]);
  for(const chapter of chapters)assert.equal(stateAt(chapter.at).chapter,chapter);
  assert.equal(stateAt(190).outro,true);
});
test('cursor is contained within frame and every click has a pulse',()=>{
  for(let t=0;t<=190;t+=.025){
    const p=cursorAt(t);
    assert.ok(p.x>=0 && p.x<1920 && p.y>=0 && p.y<1080);
  }
  for(const point of moves.filter(m=>m[3])) {
    const p=cursorAt(point[0]);
    assert.equal(p.x,point[1]);assert.equal(p.y,point[2]);assert.equal(p.click,0);
    assert.ok(cursorAt(point[0]+.1).click>0);
  }
  assert.equal(cursorAt(1).visible,false);
  assert.equal(cursorAt(7).visible,true);
  assert.equal(cursorAt(179).visible,false);
});
