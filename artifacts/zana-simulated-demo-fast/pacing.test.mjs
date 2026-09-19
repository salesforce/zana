import test from 'node:test';
import assert from 'node:assert/strict';
import './story-timeline.js';
import './timeline.js';
const T=globalThis.DemoTimeline;
test('new cut is 130 seconds and the timing map is reversible',()=>{
  assert.equal(T.DURATION,130);
  for(let t=0;t<=130;t+=.025)assert.ok(Math.abs(T.toPresentation(T.toStory(t))-t)<1e-8);
  for(const [presentation,story] of T.beats){assert.equal(T.toStory(presentation),story);assert.equal(T.toPresentation(story),presentation);}
});
test('invalid and out-of-range times are bounded',()=>{
  for(const t of [NaN,Infinity,-10]){assert.equal(T.toStory(t),0);assert.equal(T.toPresentation(t),0);}
  assert.equal(T.toStory(1000),190);assert.equal(T.toPresentation(1000),130);
  assert.equal(T.stateAt(130).outro,true);
});
test('retiming preserves every original state and action',()=>{
  for(let t=0;t<=130;t+=.025){
    const actual=T.stateAt(t),expected=T.storyStateAt(T.toStory(t));
    assert.equal(actual.chapter.label,expected.chapter.label);
    delete actual.chapter;delete expected.chapter;assert.deepEqual(actual,expected);
    assert.deepEqual(T.cursorAt(t),T.storyCursorAt(T.toStory(t)));
  }
});
test('all chapters and clicks appear at their new presentation times',()=>{
  for(const c of T.chapters)assert.equal(T.stateAt(c.at).chapter.label,c.label);
  for(const move of T.moves.filter(m=>m[3]))assert.ok(Math.abs(T.cursorAt(move[0]).click||0)<1e-8);
});
