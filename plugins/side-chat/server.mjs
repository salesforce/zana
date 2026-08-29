export default function plugin(zcc) {
  zcc.agents.configure(() => ({ instructions: "You are a side-chat helper. Stay terse." }));
}
