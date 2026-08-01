export { registerMatterHttp } from './adapters/input/http/registerMatterHttp';
export { registerMatterIpc, removeMatterIpc } from './adapters/input/ipc/registerMatterIpc';
export {
  createMatterFeature,
  type CreateMatterFeatureDeps,
  type MatterFeatureFacade,
  type MatterProposalActions,
} from './composition/createMatterFeature';
export { initializeMatterFileIfMissing } from './infrastructure/initializeMatterFile';
export { isMatterEffectivelyEmpty } from './infrastructure/matterScanState';
export { MatterFileReader } from './infrastructure/MatterFileReader';
