export default function plugin(zcc) {
  zcc.settings.define({
    notes: { type: "string", label: "Remember" }
  });
  zcc.agents.configure(async () => {
    const values = await zcc.settings.define({
      notes: { type: "string", label: "Remember" }
    }).get();
    const notes = typeof values.notes === "string" ? values.notes.trim() : "";
    return notes ? { instructions: `User memory:\n${notes}` } : {};
  });
}
