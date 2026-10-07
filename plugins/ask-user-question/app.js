const KEY = 'zcc:plugin-question-drafts:v1';
const memory = new Map();
let hydrated = false;
function store() {
  if (!hydrated) {
    hydrated = true;
    try {
      const raw = localStorage.getItem(KEY);
      const rows = raw && raw.length <= 256000 ? JSON.parse(raw) : [];
      if (Array.isArray(rows)) for (const pair of rows.slice(-40)) if (Array.isArray(pair) && typeof pair[0] === 'string') memory.set(pair[0], pair[1]);
    } catch {}
  }
  return memory;
}
function persist() {
  while (memory.size > 40) memory.delete(memory.keys().next().value);
  try {
    let raw = JSON.stringify([...memory]);
    while (raw.length > 256000 && memory.size) {memory.delete(memory.keys().next().value);raw=JSON.stringify([...memory]);}
    localStorage.setItem(KEY,raw);
  } catch {}
}
export function loadDraft(key, questions) {
  const signature=JSON.stringify(questions), saved=store().get(key);
  if (!saved || saved.signature !== signature || !Array.isArray(saved.answers) || saved.answers.length !== questions.length) return questions.map(()=>({selected:[],freeText:''}));
  return saved.answers.map((answer,index)=>{
    const labels=(questions[index].options ?? []).map(option=>option.label ?? String(option));
    return {selected:Array.isArray(answer?.selected) ? answer.selected.filter(value=>labels.includes(value)) : [],freeText:typeof answer?.freeText === 'string' ? answer.freeText.slice(0,32000) : ''};
  });
}
export function saveDraft(key,questions,answers) {store().delete(key);memory.set(key,{signature:JSON.stringify(questions),answers});persist();}
export function clearDraft(key,questions,answers) {
  if (JSON.stringify(store().get(key)) !== JSON.stringify({signature:JSON.stringify(questions),answers})) return;
  memory.delete(key);persist();
}
export function AskUserQuestionForm(props) {
  const React=globalThis.__ZCC_HOST_REACT__;
  if (!React) return null;
  const questions=Array.isArray(props.interaction.payload?.questions) ? props.interaction.payload.questions : [];
  const key=JSON.stringify([props.interaction.threadId,props.interaction.id]);
  const signature=JSON.stringify(questions);
  const [draft,setDraft]=React.useState(()=>({key,signature,answers:loadDraft(key,questions)}));
  const [busy,setBusy]=React.useState(false), [error,setError]=React.useState('');
  const answers=draft.key === key && draft.signature === signature ? draft.answers : loadDraft(key,questions);
  const update=(index,answer)=>{
    const next=answers.map((value,i)=>i===index ? answer : value);
    saveDraft(key,questions,next);setDraft({key,signature,answers:next});
  };
  const submit=async event=>{
    event.preventDefault(); if (busy) return;
    setBusy(true);setError('');
    try {
      await props.submit({answers:questions.map((question,index)=>({question:question.question ?? question.prompt ?? 'Question',selected:answers[index].selected,freeText:answers[index].freeText}))});
      clearDraft(key,questions,answers);
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Could not send answers');}
    finally {setBusy(false);}
  };
  return React.createElement('form',{onSubmit:submit},
    ...questions.map((question,index)=>React.createElement('fieldset',{key:index,disabled:busy,style:{border:0,padding:0,marginBottom:12}},
      React.createElement('legend',null,question.question ?? question.prompt ?? 'Question'),
      ...(question.options ?? []).map((option,i)=>{
        const label=option.label ?? String(option);
        return React.createElement('label',{key:i,style:{display:'block'}},React.createElement('input',{type:question.multiSelect ? 'checkbox' : 'radio',name:`question-${props.interaction.id}-${index}`,checked:answers[index].selected.includes(label),onChange:()=>update(index,{...answers[index],selected:question.multiSelect ? (answers[index].selected.includes(label) ? answers[index].selected.filter(value=>value!==label) : [...answers[index].selected,label]) : [label]})}),label);
      }),
      React.createElement('textarea',{'aria-label':`Your answer to question ${index+1}`,value:answers[index].freeText,maxLength:32000,onChange:event=>update(index,{...answers[index],freeText:event.target.value})}))),
    error && React.createElement('p',{role:'alert'},error),
    React.createElement('button',{type:'submit',disabled:busy || !questions.length || answers.some(answer=>!answer.selected.length && !answer.freeText.trim())},busy ? 'Sending…' : 'Send answers'),
    React.createElement('button',{type:'button',disabled:busy,onClick:async()=>{
      setBusy(true);setError('');
      try {await props.cancel();clearDraft(key,questions,answers);}
      catch (reason) {setError(reason instanceof Error ? reason.message : 'Could not cancel question');}
      finally {setBusy(false);}
    }},'Cancel'));
}
export default {__zccPluginApp:true,setup(app){app.slots.pendingInteraction({id:'ask-user-question',component:AskUserQuestionForm});}};
