import { ACCENT, BORDER, DIM, FAINT, INK, MUTED, toneFor } from './matterTheme';

/**
 * Controlled field primitives for the v3 dashboard. Every primitive takes a
 * plain `value` + `onChange` so panes wire them straight to the matter
 * editor's draft; none of them keep internal state.
 */

export interface InlineInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  bold?: boolean;
  color?: string;
  size?: number;
  negativeMargin?: boolean;
  mono?: boolean;
  width?: number | string;
  flex?: boolean;
  title?: string;
  readOnly?: boolean;
}

export const InlineInput = ({
  value,
  onChange,
  placeholder,
  bold,
  color,
  size,
  negativeMargin,
  mono,
  width,
  flex,
  title,
  readOnly,
}: InlineInputProps): React.JSX.Element => (
  <input
    value={value}
    readOnly={readOnly}
    title={title}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder ?? '—'}
    className="border border-transparent bg-transparent hover:border-[#d6dae2] hover:bg-white focus:border-[oklch(0.7_0.1_262)] focus:bg-white focus:outline-none"
    style={{
      font: 'inherit',
      fontSize: size ?? 12.5,
      fontWeight: bold ? 600 : 500,
      fontFamily: mono ? 'ui-monospace, monospace' : undefined,
      padding: '1px 6px',
      marginLeft: negativeMargin ? -7 : undefined,
      borderRadius: 7,
      color: color ?? (value ? INK : FAINT),
      width: flex ? undefined : (width ?? '100%'),
      flex: flex ? 1 : undefined,
      minWidth: flex ? 0 : undefined,
      boxSizing: 'border-box',
    }}
  />
);

export interface ToneSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  /** Skip status-tone coloring and render on a plain white background. */
  plain?: boolean;
  pill?: boolean;
  small?: boolean;
}

export const ToneSelect = ({
  value,
  onChange,
  options,
  plain,
  pill,
  small,
}: ToneSelectProps): React.JSX.Element => {
  const tone = plain ? { bg: '#fff', fg: INK } : toneFor(value);
  // Live data may carry values outside the design's canonical option lists.
  const effectiveOptions = options.includes(value) ? options : [value, ...options];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="cursor-pointer focus:outline-[oklch(0.75_0.1_262)]"
      style={{
        font: 'inherit',
        fontSize: small ? 11.5 : 12.5,
        fontWeight: 600,
        padding: small ? '2px 6px' : '3px 9px',
        borderRadius: pill ? 99 : small ? 7 : 8,
        border: '1px solid #d6dae2',
        background: tone.bg,
        color: tone.fg,
        maxWidth: '100%',
      }}
    >
      {effectiveOptions.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
};

/** Monospace workspace folder/document link field ("/ workspace"). */
export const DirInput = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): React.JSX.Element => (
  <InlineInput
    value={value}
    onChange={onChange}
    placeholder={placeholder ?? '/ workspace folder or document'}
    mono
    size={10.5}
    color={value ? ACCENT : DIM}
    negativeMargin
    title={value || 'No linked folder yet'}
  />
);

export const FieldLabel = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 3 }}>{children}</div>
);

export const PanelTitle = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <div
    style={{
      fontSize: 10.5,
      fontWeight: 700,
      color: FAINT,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      marginBottom: 10,
    }}
  >
    {children}
  </div>
);

/** Section header row inside a stage pane ("Requests   [+ Add request]"). */
export const SectionHeader = ({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}): React.JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      marginBottom: 8,
    }}
  >
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: MUTED,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {title}
    </div>
    {action}
  </div>
);

export const AddButton = ({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      font: 'inherit',
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 7,
      border: '1px dashed #c6ccd6',
      background: '#fff',
      color: disabled ? DIM : ACCENT,
      cursor: disabled ? 'default' : 'pointer',
      flexShrink: 0,
    }}
  >
    {label}
  </button>
);

export const DeleteButton = ({
  title,
  onClick,
  disabled,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
}): React.JSX.Element => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className="hover:border-[oklch(0.8_0.08_27)] hover:text-[oklch(0.5_0.17_27)]"
    style={{
      font: 'inherit',
      width: 20,
      height: 20,
      borderRadius: 6,
      border: `1px solid ${BORDER}`,
      background: '#fff',
      color: MUTED,
      cursor: disabled ? 'default' : 'pointer',
      fontSize: 12,
      lineHeight: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}
  >
    ×
  </button>
);

/** White card container used by every panel in the matter view. */
export const Card = ({
  children,
  padding,
  style,
}: {
  children: React.ReactNode;
  padding?: string;
  style?: React.CSSProperties;
}): React.JSX.Element => (
  <div
    style={{
      background: '#fff',
      border: `1px solid ${BORDER}`,
      borderRadius: 14,
      padding: padding ?? '18px 20px',
      boxShadow: '0 1px 2px rgba(16,24,40,0.04)',
      ...style,
    }}
  >
    {children}
  </div>
);
