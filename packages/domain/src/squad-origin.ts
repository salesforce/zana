/**
 * Host-reserved origin stamped on every Modern squad member's conversation
 * thread. Only a main-authorized create may set it; the renderer reads it as a
 * display hint and never treats it as authority.
 */
export const MODERN_SQUAD_THREAD_ORIGIN = 'host-modern-squad';

/**
 * Private binding-metadata namespace. Public pluginIdSchema rejects a leading
 * '.', so renderer/plugin metadata APIs cannot address it.
 */
export const MODERN_SQUAD_PRIVATE_NAMESPACE = `.${MODERN_SQUAD_THREAD_ORIGIN}`;
