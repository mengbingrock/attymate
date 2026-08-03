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
  createMatterFeature,
  type CreateMatterFeatureDeps,
  type MatterFeatureFacade,
  type MatterProposalActions,
} from './composition/createMatterFeature';
export { initializeMatterFileIfMissing } from './infrastructure/initializeMatterFile';
export { MatterFileReader } from './infrastructure/MatterFileReader';
export { isMatterEffectivelyEmpty } from './infrastructure/matterScanState';
