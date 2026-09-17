import type { DesignMode } from '../lib/design';

export function DesignToggle({ mode, onChange }: { mode: DesignMode; onChange: (mode: DesignMode) => void }) {
  const nextMode = mode === 'archive' ? 'classic' : 'archive';
  return (
    <button
      type="button"
      className="design-toggle"
      aria-label={`Switch to ${nextMode} design`}
      aria-pressed={mode === 'archive'}
      onClick={() => onChange(nextMode)}
    >
      <span className="design-toggle-label">{mode === 'archive' ? 'Archive style' : 'Classic style'}</span>
      <span className="design-toggle-state">{mode === 'archive' ? 'ON' : 'OFF'}</span>
    </button>
  );
}
