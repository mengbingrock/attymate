const runtimeHelpers = require('./runtimeHelpers.js');

function createControllerContext(options = {}) {
  const teamName = String(options.teamName || '').trim();
  if (!teamName) {
    throw new Error('Missing teamName');
  }

  const flags = {};
  if (typeof options.claudeDir === 'string' && options.claudeDir.trim()) {
    flags['claude-dir'] = options.claudeDir.trim();
  }

  const paths = runtimeHelpers.getPaths(flags, teamName);
  // The matters store lives in the app's own model-agnostic location; the
  // app supplies it here or process-wide via AGENT_TEAMS_MATTERS_DIR.
  if (typeof options.mattersDir === 'string' && options.mattersDir.trim()) {
    paths.mattersDir = options.mattersDir.trim();
  }
  return {
    teamName,
    claudeDir: paths.claudeDir,
    paths,
    allowUserMessageSender: options.allowUserMessageSender !== false,
  };
}

module.exports = {
  createControllerContext,
};
