import type { MatterEvidenceStatusDto } from '../../contracts';
import type { MatterEvidenceQueryBundle } from '../../core/application/ports/MatterEvidenceSourcePort';

export function buildMatterLinkRefreshPrompt(
  teamName: string,
  status: MatterEvidenceStatusDto
): string {
  return [
    `Link evidence refresh requested by the user for team "${teamName}".`,
    `Project/Link target: ${status.projectPath ?? '(unresolved)'}`,
    `Current Link state: ${status.providerState ?? status.state}. ${status.summary}`,
    '',
    'Use the Link ingestion workflow to bring pending or stale sources up to date:',
    `1. Run \`lnk ingest-status ${JSON.stringify(status.projectPath)} --json\` and follow the returned safety guidance.`,
    '2. Do not read or ingest any source Link marks blocked for secrets or access.',
    '3. Create or refresh source-backed pages under wiki/sources for pending/stale files. Preserve raw-path provenance; do not alter the original case files.',
    '4. Rebuild the Link index and backlinks once after the batch, then validate the wiki.',
    '5. Report completion and any files that remain blocked. Do not submit a matter dashboard proposal during this refresh request.',
  ].join('\n');
}

export function buildMatterLinkProposalPrompt(
  teamName: string,
  bundle: MatterEvidenceQueryBundle
): string {
  const packet = JSON.stringify(
    {
      sourceMode: bundle.source,
      sourceRevision: bundle.sourceRevision,
      generatedAt: bundle.generatedAt,
      evidence: bundle.evidence,
    },
    null,
    2
  );
  return [
    `Build a Link-backed matter dashboard proposal for team "${teamName}".`,
    `This bounded packet was produced by ${bundle.queryCount} section-specific Link queries using substantive context-packet extracts.`,
    '',
    'Required workflow:',
    `1. Call matter_get with { teamName: "${teamName}" } and compare the current dashboard with the supplied evidence.`,
    '2. Do not broadly rescan the project folder. Use only the supplied Link evidence and grounded completed-task results. If critical evidence is missing, stop and ask for a Link refresh instead of guessing.',
    '3. Propose only fields that changed. Remember that arrays replace existing arrays wholesale.',
    '4. Call matter_propose with sourceMode: "link", the exact sourceRevision below, and only the evidence references actually supporting the proposal. Add fieldPaths to each reference to identify the supported dashboard fields.',
    '5. Never invent dates, parties, amounts, deadlines, or outcomes. Leave unsupported fields absent.',
    '',
    'Bounded Link evidence packet:',
    packet,
  ].join('\n');
}
