// tweaks-panel.jsx — floating Tweaks panel with many controls

function TweaksPanel({ tweaks, setTweaks, visible }) {
  const [tab, setTab] = React.useState('Content');
  if (!visible) return null;

  const update = (patch) => {
    const next = { ...tweaks, ...patch };
    setTweaks(next);
    try {
      window.parent.postMessage(
        { type: '__edit_mode_set_keys', edits: patch },
        '*'
      );
    } catch {}
  };

  const TABS = ['Content', 'Type', 'Color', 'Layout', 'Timing', 'Motion'];

  return (
    <div style={{
      position: 'fixed',
      right: 20, top: 20, bottom: 20,
      width: 340,
      background: 'rgba(22,26,33,0.96)',
      color: '#E6ECF2',
      borderRadius: 14,
      boxShadow: '0 20px 50px rgba(0,0,0,0.4)',
      fontFamily: 'Inter, system-ui, sans-serif',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      {/* header */}
      <div style={{
        padding: '14px 18px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em',
        }}>Tweaks</div>
        <div style={{
          fontSize: 11, color: 'rgba(230,236,242,0.55)',
          fontFamily: 'ui-monospace, monospace',
        }}>Word Definition · 10s</div>
      </div>

      {/* tab bar */}
      <div style={{
        display: 'flex', gap: 2,
        padding: '8px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        overflowX: 'auto',
      }}>
        {TABS.map(label => (
          <button key={label}
            onClick={() => setTab(label)}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              fontWeight: 500,
              background: tab === label ? 'rgba(4,150,255,0.18)' : 'transparent',
              color: tab === label ? '#4DB3FF' : 'rgba(230,236,242,0.7)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >{label}</button>
        ))}
      </div>

      {/* body */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '14px 18px 20px',
        fontSize: 12,
      }}>
        {tab === 'Content' && <ContentTab tweaks={tweaks} update={update} />}
        {tab === 'Type'    && <TypeTab tweaks={tweaks} update={update} />}
        {tab === 'Color'   && <ColorTab tweaks={tweaks} update={update} />}
        {tab === 'Layout'  && <LayoutTab tweaks={tweaks} update={update} />}
        {tab === 'Timing'  && <TimingTab tweaks={tweaks} update={update} />}
        {tab === 'Motion'  && <MotionTab tweaks={tweaks} update={update} />}
      </div>
    </div>
  );
}

// ── Primitives ────────────────────────────────────────────────
function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 10, fontWeight: 600,
        color: 'rgba(230,236,242,0.55)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 6,
      }}>{label}</div>
      {children}
      {hint && (
        <div style={{
          fontSize: 10, color: 'rgba(230,236,242,0.4)',
          marginTop: 4,
          fontFamily: 'ui-monospace, monospace',
        }}>{hint}</div>
      )}
    </div>
  );
}

function TextInput({ value, onChange, multi = false, placeholder }) {
  const shared = {
    width: '100%',
    padding: '8px 10px',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: '#E6ECF2',
    fontSize: 12,
    fontFamily: 'inherit',
    outline: 'none',
    boxSizing: 'border-box',
    resize: 'vertical',
  };
  if (multi) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        style={shared}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={shared}
    />
  );
}

function Slider({ value, onChange, min, max, step = 1, suffix = '' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <input
        type="range"
        value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#0496FF' }}
      />
      <div style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        color: '#E6ECF2',
        minWidth: 58, textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : value}{suffix}
      </div>
    </div>
  );
}

function SegControl({ value, onChange, options }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      gap: 2,
      background: 'rgba(0,0,0,0.3)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 6,
      padding: 2,
    }}>
      {options.map(opt => (
        <button key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: '6px 4px',
            fontSize: 11,
            fontWeight: 500,
            background: value === opt.value ? 'rgba(4,150,255,0.25)' : 'transparent',
            color: value === opt.value ? '#4DB3FF' : 'rgba(230,236,242,0.7)',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >{opt.label}</button>
      ))}
    </div>
  );
}

function Swatches({ value, onChange, colors }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {colors.map(c => (
        <button key={c}
          onClick={() => onChange(c)}
          style={{
            width: 26, height: 26,
            background: c,
            border: value === c ? '2px solid #4DB3FF' : '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6,
            cursor: 'pointer',
            padding: 0,
          }}
          title={c}
        />
      ))}
    </div>
  );
}

function ColorPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        type="color" value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 36, height: 28,
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          cursor: 'pointer',
          padding: 2,
        }}
      />
      <input
        type="text" value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1, padding: '6px 8px',
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 6,
          color: '#E6ECF2',
          fontSize: 11,
          fontFamily: 'ui-monospace, monospace',
          outline: 'none',
        }}
      />
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────
function ContentTab({ tweaks, update }) {
  const presets = [
    { word: 'Serendipity', desc: 'The occurrence and development of events by chance in a happy or beneficial way.' },
    { word: 'Ephemeral',   desc: 'Lasting for a very short time; something that fades quickly from memory.' },
    { word: 'Petrichor',   desc: 'The pleasant, earthy smell produced when rain falls on dry soil after a long period of warm, dry weather.' },
    { word: 'Liminal',     desc: 'Relating to a transitional or initial stage of a process; occupying a position at a boundary.' },
    { word: 'Sonder',      desc: 'The realisation that each passerby is living a life as vivid and complex as your own.' },
  ];
  return (
    <>
      <Field label="Definition Title">
        <TextInput value={tweaks.definitionTitle} onChange={v => update({ definitionTitle: v })} />
      </Field>
      <Field label="Definition Description">
        <TextInput value={tweaks.definitionDescription} onChange={v => update({ definitionDescription: v })} multi />
      </Field>
      <Field label="Quick Presets">
        <div style={{ display: 'grid', gap: 6 }}>
          {presets.map(p => (
            <button key={p.word}
              onClick={() => update({ definitionTitle: p.word, definitionDescription: p.desc })}
              style={{
                padding: '8px 10px',
                textAlign: 'left',
                background: 'rgba(4,150,255,0.08)',
                border: '1px solid rgba(4,150,255,0.2)',
                borderRadius: 6,
                color: '#E6ECF2',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 11,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{p.word}</div>
              <div style={{ color: 'rgba(230,236,242,0.6)', fontSize: 10, lineHeight: 1.4 }}>{p.desc}</div>
            </button>
          ))}
        </div>
      </Field>
    </>
  );
}

function TypeTab({ tweaks, update }) {
  const fonts = [
    { value: 'Inter', label: 'Inter' },
    { value: 'Satoshi', label: 'Satoshi' },
    { value: 'Manrope', label: 'Manrope' },
    { value: 'Fraunces', label: 'Fraunces' },
  ];
  return (
    <>
      <Field label="Title Font">
        <SegControl value={tweaks.titleFont} onChange={v => update({ titleFont: v })} options={fonts} />
      </Field>
      <Field label="Title Size" hint="Guidelines spec: 74px">
        <Slider value={tweaks.titleSizePx} onChange={v => update({ titleSizePx: v })}
          min={40} max={140} step={1} suffix="px" />
      </Field>
      <Field label="Description Font">
        <SegControl value={tweaks.descriptionFont} onChange={v => update({ descriptionFont: v })} options={fonts} />
      </Field>
      <Field label="Description Size" hint="Guidelines spec: 55.5px">
        <Slider value={tweaks.descriptionSizePx} onChange={v => update({ descriptionSizePx: v })}
          min={24} max={96} step={0.5} suffix="px" />
      </Field>
    </>
  );
}

function ColorTab({ tweaks, update }) {
  return (
    <>
      <Field label="Background Style">
        <SegControl value={tweaks.backgroundStyle} onChange={v => update({ backgroundStyle: v })} options={[
          { value: 'gradient', label: 'Gradient' },
          { value: 'image',    label: 'PNG' },
          { value: 'solid',    label: 'Solid' },
          { value: 'dark',     label: 'Dark' },
        ]} />
      </Field>
      <Field label="Background Tint" hint={`oklch hue ${tweaks.backgroundTintHue}°`}>
        <Slider value={tweaks.backgroundTintHue} onChange={v => update({ backgroundTintHue: v })}
          min={0} max={360} step={1} suffix="°" />
      </Field>
      <Field label="Title Color">
        <ColorPicker value={tweaks.titleColor} onChange={v => update({ titleColor: v })} />
        <div style={{ height: 8 }} />
        <Swatches value={tweaks.titleColor} onChange={v => update({ titleColor: v })}
          colors={['#0B1B2B', '#0D2137', '#111827', '#1E293B', '#0496FF', '#0C3A66']} />
      </Field>
      <Field label="Description Color">
        <ColorPicker value={tweaks.descriptionColor} onChange={v => update({ descriptionColor: v })} />
        <div style={{ height: 8 }} />
        <Swatches value={tweaks.descriptionColor} onChange={v => update({ descriptionColor: v })}
          colors={['#4A5864', '#64748B', '#6B7280', '#556172', '#3E4A57', '#0496FF']} />
      </Field>
    </>
  );
}

function LayoutTab({ tweaks, update }) {
  return (
    <>
      <Field label="Title Left" hint="x-offset from left edge">
        <Slider value={tweaks.titleLeftPx} onChange={v => update({ titleLeftPx: v })}
          min={40} max={400} step={2} suffix="px" />
      </Field>
      <Field label="Title Top" hint="y-offset from top edge">
        <Slider value={tweaks.titleTopPx} onChange={v => update({ titleTopPx: v })}
          min={200} max={800} step={2} suffix="px" />
      </Field>
      <Field label="Banner Scale">
        <Slider value={tweaks.bannerScale} onChange={v => update({ bannerScale: v })}
          min={0.6} max={1.4} step={0.01} suffix="×" />
      </Field>
      <Field label="Icon Pill Scale">
        <Slider value={tweaks.pillScale} onChange={v => update({ pillScale: v })}
          min={0.6} max={1.4} step={0.01} suffix="×" />
      </Field>
      <Field label="Icon Glow">
        <SegControl value={tweaks.showIconGlow ? 'on' : 'off'}
          onChange={v => update({ showIconGlow: v === 'on' })}
          options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
      </Field>
    </>
  );
}

function TimingTab({ tweaks, update }) {
  return (
    <>
      <Field label="Banner Settle Time" hint="Spec: 1.47s (0:00:01:14)">
        <Slider value={tweaks.bannerSettleTime} onChange={v => update({ bannerSettleTime: v })}
          min={0.3} max={4} step={0.01} suffix="s" />
      </Field>
      <Field label="Icon Pill Settle Time" hint="Spec: 1.47s (0:00:01:14)">
        <Slider value={tweaks.pillSettleTime} onChange={v => update({ pillSettleTime: v })}
          min={0.3} max={4} step={0.01} suffix="s" />
      </Field>
      <Field label="Title Typewriter Start">
        <Slider value={tweaks.titleTypewriterStart} onChange={v => update({ titleTypewriterStart: v })}
          min={0} max={3} step={0.01} suffix="s" />
      </Field>
      <Field label="Title Typewriter End" hint="Spec: 1.30s (0:00:01:09)">
        <Slider value={tweaks.titleTypewriterEnd} onChange={v => update({ titleTypewriterEnd: v })}
          min={0.3} max={5} step={0.01} suffix="s" />
      </Field>
      <Field label="Letter Fade Duration">
        <Slider value={tweaks.titleLetterFadeDur} onChange={v => update({ titleLetterFadeDur: v })}
          min={0.05} max={1} step={0.01} suffix="s" />
      </Field>
      <Field label="Description Fade Start" hint="Spec: 0.67s (0:00:00:20)">
        <Slider value={tweaks.descFadeStart} onChange={v => update({ descFadeStart: v })}
          min={0} max={5} step={0.01} suffix="s" />
      </Field>
      <Field label="Description Fade End" hint="Spec: 2.67s (0:00:02:20)">
        <Slider value={tweaks.descFadeEnd} onChange={v => update({ descFadeEnd: v })}
          min={0.5} max={6} step={0.01} suffix="s" />
      </Field>
    </>
  );
}

function MotionTab({ tweaks, update }) {
  const dirs = [
    { value: 'top',    label: 'Top' },
    { value: 'right',  label: 'Right' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'left',   label: 'Left' },
  ];
  const eases = [
    { value: 'easeOutCubic',  label: 'OutCubic' },
    { value: 'easeOutQuart',  label: 'OutQuart' },
    { value: 'easeOutExpo',   label: 'OutExpo' },
    { value: 'easeOutBack',   label: 'OutBack' },
    { value: 'easeOutElastic',label: 'Elastic' },
    { value: 'easeInOutCubic',label: 'InOutCubic' },
  ];
  return (
    <>
      <Field label="Banner Direction">
        <SegControl value={tweaks.bannerEntryDirection} onChange={v => update({ bannerEntryDirection: v })} options={dirs} />
      </Field>
      <Field label="Banner Easing">
        <SegControl value={tweaks.bannerEase} onChange={v => update({ bannerEase: v })} options={eases.slice(0,3)} />
        <div style={{ height: 4 }} />
        <SegControl value={tweaks.bannerEase} onChange={v => update({ bannerEase: v })} options={eases.slice(3)} />
      </Field>
      <Field label="Icon Pill Direction">
        <SegControl value={tweaks.pillEntryDirection} onChange={v => update({ pillEntryDirection: v })} options={dirs} />
      </Field>
      <Field label="Icon Pill Easing">
        <SegControl value={tweaks.pillEase} onChange={v => update({ pillEase: v })} options={eases.slice(0,3)} />
        <div style={{ height: 4 }} />
        <SegControl value={tweaks.pillEase} onChange={v => update({ pillEase: v })} options={eases.slice(3)} />
      </Field>
      <Field label="Title Letter Stagger">
        <SegControl value={tweaks.titleLetterStagger} onChange={v => update({ titleLetterStagger: v })} options={[
          { value: 'linear', label: 'Linear' },
          { value: 'ease',   label: 'Ease' },
          { value: 'easeIn', label: 'Ease-In' },
          { value: 'easeOut',label: 'Ease-Out' },
        ]} />
      </Field>
      <Field label="Description Animation">
        <SegControl value={tweaks.descAnimationStyle} onChange={v => update({ descAnimationStyle: v })} options={[
          { value: 'fade',            label: 'Fade' },
          { value: 'slideUp',         label: 'Slide' },
          { value: 'blur',            label: 'Blur' },
          { value: 'typewriter-word', label: 'Words' },
        ]} />
      </Field>
    </>
  );
}

Object.assign(window, { TweaksPanel });
