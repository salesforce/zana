const { findActiveTrigger } = require('./dist/components/composer/find-active-trigger.js');
const COMPOSER_TRIGGERS = [
  { char: '@', kind: 'mention' },
  { char: '/', kind: 'command' }
];

const text = "Read /Users/geoffrey.baker/sources/doc-vault/zana/close-with-follow-up/issue.md and then ask me a question about it";

console.log("Full text cursor at end:", findActiveTrigger({
  state: {
    selection: { empty: true, from: text.length },
    doc: { textBetween: () => text }
  }
}, COMPOSER_TRIGGERS));
