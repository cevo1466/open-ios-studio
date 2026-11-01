import type { Detector, EvaluationReport, ProjectFile } from './types';
import { loadCatalogs } from './catalog';
import { evaluate } from './evaluator';
import { asrDetectors } from './detectors/asr';
import { msecDetectors } from './detectors/msec';
import { extraDetectors } from './detectors/extra';

export const allDetectors: Detector[] = [...asrDetectors, ...msecDetectors, ...extraDetectors];

/** Static, source-level analysis of a project. Never reports PASS for rules without a detector. */
export function analyzeProject(files: ProjectFile[]): EvaluationReport {
  return evaluate({ rules: loadCatalogs(), detectors: allDetectors, files });
}
