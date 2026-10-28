export const LEGACY_OWNER_CONTROL_SERVER_NAME = 'agent-teams-control';

/** Configuration names identify installations; the authorization profile remains unchanged. */
export const isOwnerControlServerName = (name: string): boolean =>
  name === LEGACY_OWNER_CONTROL_SERVER_NAME ||
  /^agent_teams_control_[a-z0-9][a-z0-9_-]{0,95}$/.test(name);

export const validateCodexMcpServerName = (name = LEGACY_OWNER_CONTROL_SERVER_NAME): string => {
  if (!isOwnerControlServerName(name)) {
    throw new Error('Invalid Agent Teams control MCP registration name');
  }
  return name;
};

export const controlMcpServerNameForInstallation = (installationId: string): string => {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(installationId)) {
    throw new Error('Invalid Agent Teams installation identifier');
  }
  return validateCodexMcpServerName(`agent_teams_control_${installationId.toLowerCase()}`);
};
