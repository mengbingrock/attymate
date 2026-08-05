import { resolveTeamLeadIdentity } from '@shared/utils/leadDetection';
import { describe, expect, it } from 'vitest';

describe('resolveTeamLeadIdentity', () => {
  it('uses leadAgentId instead of role wording', () => {
    expect(
      resolveTeamLeadIdentity({
        leadAgentId: 'team-lead@matter',
        members: [
          {
            name: 'team-lead',
            agentId: 'team-lead@matter',
            agentType: 'team-lead',
            role: 'Coordinator',
          },
          {
            name: 'source-intake-agent',
            agentId: 'source-intake-agent@matter',
            agentType: 'team-lead',
            role: 'Legal Document Intake and Pleading Review Specialist',
          },
        ],
      })
    ).toEqual({
      name: 'team-lead',
      agentId: 'team-lead@matter',
      source: 'lead-agent-id',
    });
  });

  it('ignores a stale teammate lead type when an explicit identity exists', () => {
    expect(
      resolveTeamLeadIdentity({
        lead: { name: 'captain', agentId: 'captain@matter' },
        leadAgentId: 'captain@matter',
        members: [
          { name: 'captain', agentId: 'captain@matter', agentType: 'team-lead' },
          {
            name: 'source-intake-agent',
            agentId: 'source-intake-agent@matter',
            agentType: 'team-lead',
          },
        ],
      })
    ).toEqual({
      name: 'captain',
      agentId: 'captain@matter',
      source: 'explicit',
    });
  });

  it('does not infer a lead from any human-authored role', () => {
    expect(
      resolveTeamLeadIdentity({
        members: [
          { name: 'pleading-agent', role: 'Pleading Lead and Review Specialist' },
          { name: 'researcher', role: 'Researcher' },
        ],
      })
    ).toEqual({ name: 'team-lead', source: 'default' });
  });

  it('supports one custom legacy lead only through typed runtime metadata', () => {
    expect(
      resolveTeamLeadIdentity({
        members: [
          { name: 'captain', agentId: 'captain@matter', agentType: 'orchestrator' },
          { name: 'researcher', role: 'Lead Researcher' },
        ],
      })
    ).toEqual({
      name: 'captain',
      agentId: 'captain@matter',
      source: 'legacy-agent-type',
    });
  });
});
