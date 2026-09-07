/** BB thread/runtime domain surface. Isolated from product.ts / TerminalSession. */
export * from './bb-thread/index.js';

// Named re-exports so bundlers (electron-vite/rolldown) that omit colliding or
// nested `export *` members still see the plugin-icon and system-message APIs.
export {
  NAMESPACED_GLYPH_PATTERN,
  PLUGIN_ICON_MAX_BYTES,
  PLUGIN_ICON_NAME_MAX_LENGTH,
  PLUGIN_ICON_NAME_PATTERN,
  PLUGIN_ICONS_MAX_COUNT,
  isNamespacedGlyph,
  isPluginOwnedIconPath,
  parseNamespacedGlyph
} from './bb-thread/plugin-icon.js';
export {
  systemMessageKindSchema,
  systemMessageSubjectSchema,
  type SystemMessageKind,
  type SystemMessageSubject
} from './bb-thread/system-message.js';
