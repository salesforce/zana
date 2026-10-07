# Zana for Slack

Final script · 74 seconds · Slack to your computer and back

## Storyboard and voiceover

| Time | On screen | Voiceover |
| --- | --- | --- |
| 00–05 | A Slack thread with the answered question and Zana's answer, in front of the Zana desktop thread running Pi. Title: **Zana, right inside Slack.** | "Meet Zana for Slack, shown here with Pi." |
| 05–17 | In #sales-cloud-dev (linked to **Sales Cloud App**), type `@Za`, pick **Zana · APP** from the autocomplete, and send `@Zana Fix the failing AccountService tests and summarize the change.`. No form. A side card shows the channel defaults set in Zana: Project, **Pi**, and `anthropic/claude-sonnet-5-5`. Zana replies in the message thread; open it to see **Working…**. | "In a linked channel, just mention Zana with your task. Zana uses that channel’s Project and harness: Pi here, or any harness installed in Zana." |
| 17–30 | The Slack thread. A side card shows Pi on your computer: `sf_apex test.run` (3 failing), `sf_apex diagnose.file`. Zana posts the question "Three tests fail because the test Accounts have no Owner. How should I fix it?" with **Answer questions**; the status reads **Answer the questions here to continue.** **Answer Zana** opens; pick **Handle a missing Owner in AccountService** and click **Send answers**. A new **Working…** status appears while Pi edits the code and `sf_apex test.rerun` passes 12 of 12. | "Pi works on your own computer. When it needs a decision, it asks right in the Slack thread. Answer there, and Pi fixes the code and reruns the tests." |
| 30–41 | In the Slack thread, below the answered question, the **Working…** status message is replaced by the answer. | "When the turn ends, Zana posts the answer right back in your Slack thread: what changed, and how the tests did." |
| 41–52 | Type a plain thread reply asking for a bulk-insert test. A new **Working…** status appears, then the answer with 13 of 13 passing. | "Reply in the thread to keep going. Zana continues the same conversation, with the same Project, machine, and harness." |
| 52–64 | The Zana app's private agent chat: the welcome message and prompt chips. Tap **Unread reports**; Zana replies in plain text with a numbered list of three sample reports. | "Or message Zana privately. Ask for your unread reports, and it reads them straight from your Zana inbox." |
| 64–74 | **Zana · Your agents** on the Home tab: summary line, **+ New agent** and **Refresh**, then Running and Recent conversations. One recent card is a private-chat agent. Highlight the running card, then **Stop**. Footer: **Keep your computer awake and online, with Zana running.** | "Zana Home lists every agent, so you can follow, mute, or stop them. Just keep your computer awake, with Zana running." |

## Production direction

- Pi is the example harness. Say that Slack launches work with any harness installed in Zana; do not name harness packages or extensions.
- Use sample data only: Acme workspace, **Sales Cloud App** Project, #sales-cloud-dev, `my-dev-sandbox` org, and Sam Rivera.
- Questions are answered in Slack. Do not show permission approvals: they are reviewed in Zana, and Slack cannot grant them.
- Keep the same visual system and Ava voice as the other Zana videos.
