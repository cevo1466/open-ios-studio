import { useEffect, useRef, useState } from 'react';

export interface Command {
  id: string;
  title: string;
  enabled: boolean;
  hint?: string;
  run: () => void;
}

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const shown = commands.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()));
  const runFirst = () => {
    const first = shown.find((c) => c.enabled);
    if (first) {
      onClose();
      first.run();
    }
  };

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          placeholder="Type a command…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter') runFirst();
          }}
        />
        <ul>
          {shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!c.enabled}
                onClick={() => {
                  onClose();
                  c.run();
                }}
              >
                {c.title}
                {c.hint && <span className="hint">{c.hint}</span>}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="tree-note">No matching command.</li>}
        </ul>
      </div>
    </div>
  );
}
