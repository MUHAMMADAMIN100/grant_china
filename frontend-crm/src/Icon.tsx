type Props = {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

export default function Icon({ name, size, className, style }: Props) {
  return (
    <span
      className={`material-symbols-rounded${className ? ' ' + className : ''}`}
      style={size ? { fontSize: size, ...style } : style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
