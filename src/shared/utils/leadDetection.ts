/**
 * Lead agent type detection.
 *
 * CLI Claude Code assigns inconsistent agentType values to the lead member
 * across different versions/runs: "team-lead", "lead", "orchestrator",
 * or even "general-purpose". This module centralizes lead detection
 * so the rest of the codebase does not need to hard-code any single value.
 */

const LEAD_AGENT_TYPES = new Set(['team-lead', 'lead', 'orchestrator']);

export interface ResolvedTeamLeadIdentity {
  name: string;
  agentId?: string;
  source: 'explicit' | 'lead-agent-id' | 'canonical-name' | 'legacy-agent-type' | 'default';
}

interface LeadIdentityMember {
  name?: unknown;
  agentId?: unknown;
  agentType?: unknown;
  /** Accepted for structural compatibility but intentionally never inspected. */
  role?: unknown;
}

interface LeadIdentityConfig {
  lead?: unknown;
  leadAgentId?: unknown;
  members?: readonly LeadIdentityMember[];
}

function normalizedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve the lead exclusively from structured identity fields. Role text and
 * other human-authored wording are deliberately ignored.
 */
export function resolveTeamLeadIdentity(
  config: LeadIdentityConfig | null | undefined
): ResolvedTeamLeadIdentity {
  const members = Array.isArray(config?.members) ? config.members : [];
  const explicitLead =
    config?.lead && typeof config.lead === 'object'
      ? (config.lead as { name?: unknown; agentId?: unknown })
      : null;
  const explicitName = normalizedString(explicitLead?.name);
  if (explicitName) {
    const explicitAgentId = normalizedString(explicitLead?.agentId);
    return {
      name: explicitName,
      ...(explicitAgentId ? { agentId: explicitAgentId } : {}),
      source: 'explicit',
    };
  }

  const leadAgentId = normalizedString(config?.leadAgentId);
  if (leadAgentId) {
    const matched = members.find(
      (member) => normalizedString(member.agentId) === leadAgentId && normalizedString(member.name)
    );
    const matchedName = normalizedString(matched?.name);
    if (matchedName) {
      return { name: matchedName, agentId: leadAgentId, source: 'lead-agent-id' };
    }
  }

  const canonical = members.find(
    (member) => normalizedString(member.name)?.toLowerCase() === 'team-lead'
  );
  const canonicalName = normalizedString(canonical?.name);
  if (canonicalName) {
    const canonicalAgentId = normalizedString(canonical?.agentId);
    return {
      name: canonicalName,
      ...(canonicalAgentId ? { agentId: canonicalAgentId } : {}),
      source: 'canonical-name',
    };
  }

  // Compatibility for old custom-named leads. This consumes typed runtime
  // metadata only and is accepted solely when it identifies exactly one row.
  const typedLeads = members.filter((member) =>
    isLeadAgentType(normalizedString(member.agentType))
  );
  if (typedLeads.length === 1) {
    const legacyName = normalizedString(typedLeads[0]?.name);
    if (legacyName) {
      const legacyAgentId = normalizedString(typedLeads[0]?.agentId);
      return {
        name: legacyName,
        ...(legacyAgentId ? { agentId: legacyAgentId } : {}),
        source: 'legacy-agent-type',
      };
    }
  }

  return {
    name: 'team-lead',
    ...(leadAgentId ? { agentId: leadAgentId } : {}),
    source: 'default',
  };
}

export function isResolvedTeamLead(
  member: { name?: unknown; agentId?: unknown },
  lead: Pick<ResolvedTeamLeadIdentity, 'name' | 'agentId'>
): boolean {
  const memberAgentId = normalizedString(member.agentId);
  if (lead.agentId && memberAgentId) {
    return memberAgentId === lead.agentId;
  }
  const memberName = normalizedString(member.name);
  return memberName?.toLowerCase() === lead.name.trim().toLowerCase();
}

/**
 * Returns true if the given agentType string identifies a team lead.
 * Handles all known CLI variants: "team-lead", "lead", "orchestrator".
 *
 * Does NOT match "general-purpose" — that value is ambiguous and used
 * for regular teammates too. Lead detection for "general-purpose" agents
 * must rely on name-based checks (see {@link isLeadMember}).
 */
export function isLeadAgentType(agentType: string | undefined | null): boolean {
  if (!agentType) return false;
  return LEAD_AGENT_TYPES.has(agentType);
}

/**
 * Returns true if the member is a team lead, checking both agentType
 * and the conventional "team-lead" name as a fallback.
 */
export function isLeadMember(member: { agentType?: unknown; name?: unknown }): boolean {
  const agentType = typeof member.agentType === 'string' ? member.agentType : null;
  if (isLeadAgentType(agentType)) return true;
  const name = typeof member.name === 'string' ? member.name.trim().toLowerCase() : '';
  return name === 'team-lead';
}
