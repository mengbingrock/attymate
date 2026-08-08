export { registerMatterHttp } from './adapters/input/http/registerMatterHttp';
export { registerMatterIpc, removeMatterIpc } from './adapters/input/ipc/registerMatterIpc';
export {
  type LinkCommandInvocation,
  type LinkCommandResult,
  type LinkCommandRunner,
  LinkCommandUnavailableError,
  NodeLinkCommandRunner,
  resolveLinkCommandInvocation,
} from './adapters/output/link/LinkCommandRunner';
export { LinkMatterEvidenceSourceAdapter } from './adapters/output/link/LinkMatterEvidenceSourceAdapter';
export {
  MatterLinkCoordinator,
  type MatterLinkCoordinatorDeps,
  type MatterLinkLeadNotifier,
} from './application/MatterLinkCoordinator';
export {
  MatterRefreshCoordinator,
  type MatterRefreshCoordinatorDeps,
  type MatterRefreshRequest,
  type MatterTeamRuntimeFacts,
} from './application/MatterRefreshCoordinator';
export {
  buildMatterSkillInvocationPrompt,
  type MatterSkillInvocationInput,
} from './application/MatterSkillLeadPrompt';
export {
  createMatterFeature,
  type CreateMatterFeatureDeps,
  type MatterFeatureFacade,
  type MatterStoreActions,
} from './composition/createMatterFeature';
export { isMatterSnapshotEffectivelyEmpty } from './infrastructure/matterScanState';
export { normalizeMatterSnapshot } from './infrastructure/matterSnapshot';
export { MatterSkillSeeder } from './infrastructure/MatterSkillSeeder';
export { readTeamRuntimeFacts } from './infrastructure/teamRuntimeFacts';
