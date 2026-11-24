// In a file of its own so the database layer can read it without importing the
// builder, which reaches core's extension-point registry - and that registry
// imports this module's own agent-content provider, which imports the database
// layer. A value import from documents.ts there is a cycle.

/**
 * Which revision of this builder wrote a stored twin.
 *
 * Bump it whenever the OUTPUT changes shape - a new section, a section that
 * reads differently, a fact added or taken away. The rebuild treats any twin
 * written by an older revision as stale whatever its content has been doing,
 * so the next scheduled run carries the whole site over to the new shape on
 * its own, a time-budget's worth at a time. See migrations/006.
 *
 *   1 - every combination listed with one column per option; the options and
 *       their values; add-ons; delivery services and charges; photographs;
 *       downloads; customer reviews; GTIN.
 */
export const DOCUMENT_BUILDER_REVISION = 1
