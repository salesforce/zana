/* Edit pacing without changing the fictional story's action order. */
(() => {
  const story=globalThis.DemoTimeline;
  const beats=[
    [0,0],[4,7],[5,8.5],[6.5,11],[9.4,16.5],[11,19.5],[14,23],
    [15,25],[16.5,28],[17,29],[20.5,34.7],[21.5,36],[25,43],
    [28.5,46],[31.5,50.5],[33,53],[34.3,55],[35.7,57.5],
    [37.6,60.5],[39.5,63],[42.8,68],[44.2,70],[47,73],[51,79],
    [55,85],[57,89],[59,92],[61,94],[63,97],[66,101],[70,107],
    [73.5,113],[77.5,119],[80.5,125],[81,126],[86.5,135],
    [87.5,137],[89,139],[91,142],[94,146],[97,150],[100,154],
    [103.5,158.5],[105,161],[108,164.5],[110.8,168],[112.4,170],
    [114.5,173],[115.5,174],[119,178],[130,190],
  ];
  function mapTime(input, from, to) {
    const last=beats.at(-1);
    const value=Math.max(0,Math.min(Number.isFinite(input)?input:0,last[from]));
    const next=beats.findIndex(beat=>beat[from]>value);
    if(next<0)return last[to];
    const a=beats[Math.max(0,next-1)], b=beats[next];
    return Math.round((a[to]+(b[to]-a[to])*(value-a[from])/(b[from]-a[from]))*1e9)/1e9;
  }
  const toStory=t=>mapTime(t,0,1);
  const toPresentation=t=>mapTime(t,1,0);
  const chapters=story.chapters.map(chapter=>({...chapter,at:toPresentation(chapter.at)}));
  globalThis.DemoTimeline={
    ...story,DURATION:130,beats,toStory,toPresentation,chapters,
    storyStateAt:story.stateAt,storyCursorAt:story.cursorAt,
    stateAt(t){const state=story.stateAt(toStory(t));return {...state,chapter:chapters.filter(c=>c.at<=toPresentation(state.t)).at(-1)};},
    cursorAt(t){return story.cursorAt(toStory(t));},
    moves:story.moves.map(move=>[toPresentation(move[0]),...move.slice(1)]),
  };
})();
