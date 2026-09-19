import test from 'node:test';
import assert from 'node:assert/strict';
import './story-timeline.js';
import './timeline.js';
const T=globalThis.DemoTimeline;
test('148-second timing map preserves a reversible story clock',()=>{
  assert.equal(T.DURATION,148);
  for(let t=0;t<=148;t+=.025)assert.ok(Math.abs(T.toPresentation(T.toStory(t))-t)<1e-8);
  for(const [presentation,story] of T.beats){assert.equal(T.toStory(presentation),story);assert.equal(T.toPresentation(story),presentation);}
});
test('all clocks safely bound invalid and out-of-range input',()=>{
  for(const t of [NaN,Infinity,-10]){assert.equal(T.toStory(t),0);assert.equal(T.toPresentation(t),0);assert.equal(T.stateAt(t).p,0);}
  assert.equal(T.toStory(1000),190);assert.equal(T.toPresentation(1000),148);
  assert.equal(T.stateAt(1000).outro,true);
});
test('CLI selection precedes launch, output precedes success, and close returns to board',()=>{
  assert.equal(T.stateAt(51).view,'board');
  assert.equal(T.stateAt(51.8).view,'cli-compose');
  assert.equal(T.stateAt(52.79).cliSelected,false);
  assert.equal(T.stateAt(52.8).cliSelected,true);
  assert.equal(T.stateAt(58.4).cliPrompt,T.cliPrompt);
  assert.equal(T.stateAt(58.99).cliLaunched,false);
  assert.equal(T.stateAt(59).view,'cli-terminal');
  assert.equal(T.stateAt(61).cliRead,true);
  assert.equal(T.stateAt(61).cliFullscreen,false);
  assert.equal(T.stateAt(62).cliFullscreen,true);
  assert.equal(T.stateAt(63).cliEdit,true);
  assert.equal(T.stateAt(64.6).cliTests,true);
  assert.equal(T.stateAt(67.39).cliPassed,false);
  assert.equal(T.stateAt(67.4).cliPassed,true);
  assert.equal(T.stateAt(70.7).view,'board');
  assert.equal(T.stateAt(73).view,'gus');
});
test('retiming preserves prior workflow state outside the CLI sequence',()=>{
  for(let t=0;t<=148;t+=.05){
    const actual=T.stateAt(t),expected=T.storyStateAt(T.toStory(t));
    for(const key of Object.keys(expected)){
      if(key==='chapter'||((key==='view'||key==='modal')&&t>=51.8&&t<70.7))continue;
      assert.deepEqual(actual[key],expected[key]);
    }
    if(t<51||t>=73)assert.deepEqual(T.cursorAt(t),T.storyCursorAt(T.toStory(t)));
  }
});
test('eight chapters include the CLI segment and have valid starts',()=>{
  assert.equal(T.chapters.length,8);
  assert.equal(T.chapters[4].label,'CLI Agent');
  for(const c of T.chapters)assert.equal(T.stateAt(c.at).chapter.label,c.label);
});
test('CLI cursor stays in frame, clicks its beats, and is deterministic when rewound',()=>{
  for(let t=50;t<=75;t+=.025){
    const cursor=T.cliCursorAt(t);
    assert.ok(cursor.x>=0&&cursor.x<1920&&cursor.y>=0&&cursor.y<1080);
    assert.deepEqual(T.cliCursorAt(t),cursor);
  }
  for(const move of T.cliMoves.filter(m=>m[3])){
    const cursor=T.cliCursorAt(move[0]);
    assert.equal(cursor.x,move[1]);assert.equal(cursor.y,move[2]);assert.equal(cursor.click,0);
  }
});
