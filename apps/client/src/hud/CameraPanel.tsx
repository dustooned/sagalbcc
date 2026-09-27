// Bottom left: camera buttons — the same orbit/zoom/reset as right-drag and the wheel, for
// touch screens, trackpads and anyone who doesn't know the mouse shortcuts. Each pair of buttons
// sits under a plain-word label, and the panel folds up like the others.
import { useState } from 'react';
import { cameraControls } from '../table/CameraRig.tsx';

export function CameraPanel() {
  const [open, setOpen] = useState(() => window.innerWidth > 700);
  const btn = (label: string, title: string, fn: () => void) => (
    <button className="cam-btn" title={title} aria-label={title} onClick={fn}>{label}</button>
  );
  return (
    <section className={`hud-panel cam-panel ${open ? 'open' : ''}`} aria-label="Camera">
      <button className="tools-head" onClick={() => setOpen(o => !o)}>🎥<span className="head-label"> CAMERA</span> <span>{open ? '▾' : '▸'}</span></button>
      {open && (
        <div className="cam-body">
          <div className="cam-group"><span>TURN</span>{btn('↺', 'Turn left', () => cameraControls.rotate(45))}{btn('↻', 'Turn right', () => cameraControls.rotate(-45))}</div>
          <div className="cam-group"><span>TILT</span>{btn('▲', 'Tilt up', () => cameraControls.tilt(12))}{btn('▼', 'Tilt down', () => cameraControls.tilt(-12))}</div>
          <div className="cam-group"><span>ZOOM</span>{btn('−', 'Zoom out', () => cameraControls.zoom(1.25))}{btn('+', 'Zoom in', () => cameraControls.zoom(0.8))}</div>
          <div className="cam-wide">
            <button className="btn small" onClick={() => cameraControls.topDown()}>Top view</button>
            <button className="btn small" onClick={() => cameraControls.reset()} title="Home key">Reset</button>
          </div>
          <p className="cam-hint">Mouse: right-drag turns · wheel zooms · middle-drag pans</p>
        </div>
      )}
    </section>
  );
}
