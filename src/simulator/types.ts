export interface UINode {
  kind: string;
  id: string;
  props: Record<string, string>;
  children: UINode[];
}
export interface Frame { revision: number; root: UINode }
export type SimulatorEvent = { kind: 'frame'; frame: Frame } | { kind: 'log'; text: string } | { kind: 'exit'; code: number | null };
export interface BuildResult { ok: boolean; output: string[] }
export type SendInput = (id: string, value?: string | boolean | number) => void;

export interface SimulatorInfo { bundleId: string; runtimeBytes: number; exampleBytes: number; platformSupported: boolean; compilerPath: string | null }
