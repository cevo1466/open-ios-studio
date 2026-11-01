import { useId, useState } from 'react';
import { effortChoices, modelChoices } from '../ai/models';
import type { ProviderId } from '../ai/types';

interface Props {
  provider: ProviderId;
  model: string;
  effort: string;
  onModel(value: string): void;
  onEffort(value: string): void;
  /** Compact: one row, used above the chat composer. */
  compact?: boolean;
}

const CUSTOM = '__custom__';

/**
 * Model and reasoning-effort pickers for the subscription CLIs. Claude shows Sonnet / Opus / Haiku;
 * Codex model names change often, so it also offers a free-text "Özel" entry.
 */
export function ModelPicker({ provider, model, effort, onModel, onEffort, compact }: Props) {
  const modelId = useId();
  const effortId = useId();
  const models = modelChoices(provider);
  const efforts = effortChoices(provider);
  const known = models?.some((c) => c.value === model) ?? false;
  const [custom, setCustom] = useState(false);
  const showCustom = custom || (!known && model !== '');
  if (!models) return null;
  const selected = showCustom ? CUSTOM : model;
  const hint = models.find((c) => c.value === model)?.hint;
  const effortHint = efforts?.find((c) => c.value === effort)?.hint;

  return (
    <div className={`model-picker${compact ? ' compact' : ''}`}>
      <label className="mp-field" htmlFor={modelId}>
        <span>Model</span>
        <select
          id={modelId}
          aria-label="Model"
          value={selected}
          onChange={(e) => {
            if (e.target.value === CUSTOM) {
              setCustom(true);
            } else {
              setCustom(false);
              onModel(e.target.value);
            }
          }}
        >
          {models.map((c) => (
            <option key={c.value || 'default'} value={c.value}>
              {c.label}
            </option>
          ))}
          <option value={CUSTOM}>Özel…</option>
        </select>
      </label>
      {efforts && (
        <label className="mp-field" htmlFor={effortId}>
          <span>Efor</span>
          <select id={effortId} aria-label="Efor" value={effort} onChange={(e) => onEffort(e.target.value)}>
            {efforts.map((c) => (
              <option key={c.value || 'default'} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {showCustom && (
        <input
          type="text"
          aria-label="Özel model adı"
          className="mp-custom"
          value={model}
          onChange={(e) => onModel(e.target.value)}
          placeholder="Model adı"
          spellCheck={false}
          autoComplete="off"
        />
      )}
      {!compact && (hint || effortHint) && <p className="ai-note mp-hint">{[hint, effortHint && `Efor: ${effortHint}`].filter(Boolean).join(' · ')}</p>}
    </div>
  );
}
