/**
 * Prompt prefixes that seed the composer when the user asks ZCC to create
 * one of its own resources. Every entry point for a kind — hub button,
 * browse CTA, composer plus — uses the same prefix so the instruction the
 * agent reads does not drift between surfaces.
 */

export const CREATE_PLUGIN_PROMPT = 'Create a new zcc plugin that ';
