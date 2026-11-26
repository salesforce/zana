/** Step 4: "Meet Advanced". The coachmark itself is owned by the companion. */
export function AdvancedStep({ mode, coachOpen, onShow, onSwitch, onStay }: {
  mode: 'basic' | 'advanced';
  coachOpen: boolean;
  onShow: () => void;
  onSwitch: () => void;
  onStay: () => void;
}) {
  return <>
    <p>{mode === 'basic'
      ? <>You’re in <b>Basic</b>: threads and projects only. When you want parallel CLI agents, squads, schedules or plugins, switch to <b>Advanced</b> with the view switch in the top-right corner. Nothing is lost when you switch back.</>
      : <>You’re in <b>Advanced</b>: the full command center is in your sidebar. You can switch back to Basic from the top-right view switch at any time.</>}</p>
    <div className="onb-row">
      {mode === 'basic' ? <button type="button" className="onb-btn" aria-pressed={coachOpen} onClick={onShow}>Show me where</button> : null}
      <button type="button" className="onb-btn q sm" onClick={onStay}>{mode === 'basic' ? 'I’ll stay in Basic' : 'Done'}</button>
      <span className="onb-sp" />
      {mode === 'basic' ? <button type="button" className="onb-btn p" onClick={onSwitch}>Try Advanced</button> : null}
    </div>
  </>;
}
