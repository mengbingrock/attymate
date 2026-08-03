import type {
  MatterEvidenceRefDto,
  MatterEvidenceSourceMode,
  MatterEvidenceStatusDto,
} from '../../../contracts/evidence';

export interface MatterEvidenceContext {
  teamName: string;
  projectPath: string | null;
}

/** Output port implemented by main-process evidence providers. */
export interface MatterEvidenceSourcePort {
  readonly source: MatterEvidenceSourceMode;
  getStatus(context: MatterEvidenceContext): Promise<MatterEvidenceStatusDto>;
  initialize(context: MatterEvidenceContext): Promise<MatterEvidenceStatusDto>;
  queryDashboardEvidence(context: MatterEvidenceContext): Promise<MatterEvidenceQueryBundle>;
}

export interface MatterEvidenceItem {
  topic: string;
  summary: string;
  whySelected?: string;
  reference: MatterEvidenceRefDto;
}

export interface MatterEvidenceQueryBundle {
  source: 'link';
  generatedAt: string;
  sourceRevision: string;
  queryCount: number;
  evidence: MatterEvidenceItem[];
}
