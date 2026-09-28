// Round swatches for the colours a saree comes in. A colour without a swatch
// shows its first letter instead.
export default function ColorSwatches({ colors, selected, onSelect, size = "" }) {
  return (
    <div className={`swatches ${size}`} role="radiogroup" aria-label="Colour">
      {colors.map((c) => (
        <button
          key={c.name}
          type="button"
          role="radio"
          aria-checked={c.name === selected}
          aria-label={c.name}
          title={c.name}
          className={`swatch ${c.name === selected ? "active" : ""} ${c.hex ? "" : "blank"}`}
          style={c.hex ? { background: c.hex } : undefined}
          onClick={() => onSelect(c.name)}
        >
          {!c.hex && c.name.charAt(0).toUpperCase()}
        </button>
      ))}
    </div>
  );
}
