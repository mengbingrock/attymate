/**
 * Public domain surface of team-import.
 *
 * These are the rules that define what an importable team folder looks like.
 * team-export consumes them so an export is, by construction, something this
 * importer can read back.
 */
export {
  buildClaudeAgentDefinitionMarkdown,
  bundleToPreview,
} from './domain/teamImportAgentFilesPolicy';
export { parseTeamImportBundle } from './domain/teamImportBundlePolicy';
export {
  extractTeamImportMarkdownBody,
  LEAD_PREFIX,
  MEMBER_PREFIX,
  parseTeamImportFrontmatter,
  suggestTeamImportName,
  validateImportedMemberName,
  validateTeamImportName,
} from './domain/teamImportPolicy';
