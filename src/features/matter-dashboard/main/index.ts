export { registerMatterHttp } from './adapters/input/http/registerMatterHttp';
export { registerMatterIpc, removeMatterIpc } from './adapters/input/ipc/registerMatterIpc';
export {
  createMatterFeature,
  type CreateMatterFeatureDeps,
  type MatterFeatureFacade,
  type MatterProposalActions,
} from './composition/createMatterFeature';
export { MatterFileReader } from './infrastructure/MatterFileReader';
