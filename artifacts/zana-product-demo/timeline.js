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
  ].map(([present,story])=>[present>=55?present+18:present,story]);
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
  chapters.splice(4,0,{at:51,label:'CLI Agent',title:'04  /  Your agent, in the terminal'});
  chapters[5].title='05  /  Keep your tickets close';
  chapters[6].title='06  /  Make Zana your own';
  const cliPrompt='Review the dashboard changes, run the tests, and summarize anything I should check before merging.';
  const cliMoves=[[51,173,241,1],[51.8,1796,161,1],[52.8,1375,417,1],[54,1088,513,1],[59,1512,595,1],[62,1523,187,1],[63.5,1410,530],[70.7,1831,121,1],[71.4,800,475],[73,173,393,1]];
  function cliCursorAt(t){
    const next=cliMoves.findIndex(m=>m[0]>t), b=next<0?cliMoves.length-1:next;
    const from=cliMoves[Math.max(0,b-1)],to=cliMoves[b];
    const start=Math.max(from[0],to[0]-.45);
    const f=Math.max(0,Math.min(1,(t-start)/Math.max(.001,to[0]-start))),ease=f*f*(3-2*f);
    const click=cliMoves.findLast(m=>m[3]&&m[0]<=t),age=click?t-click[0]:Infinity;
    return {x:from[1]+(to[1]-from[1])*ease,y:from[2]+(to[2]-from[2])*ease,click:age<.5?age/.5:null,visible:true};
  }
  globalThis.DemoTimeline={
    ...story,DURATION:148,cliPrompt,cliMoves,cliCursorAt,beats,toStory,toPresentation,chapters,
    storyStateAt:story.stateAt,storyCursorAt:story.cursorAt,
    stateAt(input){
      const p=Math.max(0,Math.min(Number.isFinite(input)?input:0,148));
      const state=story.stateAt(toStory(p));
      const cli=p>=51.8&&p<70.7;
      return {...state,p,view:cli?(p<59?'cli-compose':'cli-terminal'):state.view,
        modal:cli?null:state.modal,cliSelected:p>=52.8,cliLaunched:p>=59,
        cliFullscreen:p>=62,cliRead:p>=60.6,cliEdit:p>=63,cliTests:p>=64.6,cliPassed:p>=67.4,cliIdle:p>=70.1,
        cliPrompt:story.typed(cliPrompt,p,54,58.4),cliStage:Math.floor(p*12),
        chapter:chapters.filter(c=>c.at<=p).at(-1)};
    },
    cursorAt(t){return t>=51&&t<73?cliCursorAt(t):story.cursorAt(toStory(t));},
    moves:story.moves.map(move=>[toPresentation(move[0]),...move.slice(1)]),
  };
})();
