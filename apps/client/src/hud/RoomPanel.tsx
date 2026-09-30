// Top left: the rune (click to copy an invite link) and who's in your party.
import { useState, type FormEvent } from 'react';
import { MAX_COUNTERS, SEAT_COLORS } from '@kitforge/shared-types';
import { leaveTable } from '../net/connection.ts';
import { copyInvite } from '../net/invite.ts';
import { actions } from '../pieces/actions.ts';
import { useTable } from '../net/tableStore.ts';

export function RoomPanel() {
  const t = useTable();
  // Which counter's name is being edited: '' = none, '+' = a new one.
  const [editing, setEditing] = useState('');
  const [draft, setDraft] = useState('');
  // Which counter value is being typed into, as `playerId:KEY`.
  const [typing, setTyping] = useState('');
  // Hooks stay above this early return — React needs the same hooks on every render.
  const state = t.state;
  if (!state) return null;
  const players = [...state.players.values()].sort((a, b) => a.seat - b.seat);
  const counters = [...state.counterNames];
  const edit = (k: string) => { setEditing(k); setDraft(k === '+' ? '' : k); };
  const save = (e?: FormEvent) => {
    e?.preventDefault();
    const name = draft.trim();
    if (name) { if (editing === '+') actions.addCounter(name); else actions.renameCounter(editing, name); }
    setEditing('');
  };
  const copy = () => void copyInvite(state.roomCode, text => t.notify(text));

  return (
    <section className="hud-panel room-panel">
      <div className="room-row">
        <button className="room-code" onClick={copy} title="Copy an invite link">{state.roomCode}</button>
        <button className="btn small" onClick={copy} title="Copy a link that opens this table">🔗 Invite</button>
        <button className="btn small ghost" onClick={() => void leaveTable()} title="Leave the table">Leave</button>
      </div>
      <div className="party-row">
        <p className="party-label">PARTY · {players.length} player{players.length === 1 ? '' : 's'}</p>
        <span className="muted small">COUNTERS</span>
        <span className="counter-count">
                <button className="counter-name add" title="Remove the last counter" disabled={counters.length === 0}
                  onClick={() => { const last = counters[counters.length - 1]; if (last && confirm(`Remove ${last} for everyone?`)) actions.removeCounter(last); }}>−</button>
                <button className="counter-name add" title="Add a point counter" disabled={counters.length >= MAX_COUNTERS} onClick={() => edit('+')}>＋</button>
              </span>
      </div>
      <div className="players-scroll"><table className="players">
        <thead>
          <tr>
            <th />
            {counters.map(k => (
              <th key={k}><button className="counter-name" title={`Rename or remove ${k}`} onClick={() => edit(k)}>{k} ✎</button></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.id} className={p.connected ? '' : 'away'}>
              <td className="who">
                <i className="dot" style={{ background: SEAT_COLORS[p.seat % SEAT_COLORS.length] }} />
                <b>{p.name}</b>
                {p.id === state.hostId && <span title="Host">👑</span>}
                {p.id === t.playerId && <span className="muted you">(you)</span>}
                {!p.connected && <span className="muted">away</span>}
                {t.isHost() && p.id !== t.playerId && (
                  <button className="icon-btn" title={`Remove ${p.name}`} onClick={() => { if (confirm(`Remove ${p.name} from the table?`)) t.send('kick', { playerId: p.id }); }}>✕</button>
                )}
              </td>
              {counters.map(k => {
                const v = p.counters.get(k) ?? 0;
                return (
                  <td key={k}>
                    <div className="counter">
                      <button onClick={() => actions.counter(p.id, k, -1)} aria-label={`${p.name} ${k} minus`}>−</button>
                      {typing === `${p.id}:${k}` ? (
                        <input className="counter-input" type="number" inputMode="numeric" autoFocus defaultValue={v} aria-label={`${p.name} ${k}`}
                          onBlur={e => { const n = Number(e.currentTarget.value); if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) actions.setCounter(p.id, k, n); setTyping(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setTyping(''); }} />
                      ) : (
                        <output title="Tap to type a number" onClick={() => setTyping(`${p.id}:${k}`)}>{v}</output>
                      )}
                      <button onClick={() => actions.counter(p.id, k, 1)} aria-label={`${p.name} ${k} plus`}>+</button>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
      {editing && (
        <form className="counter-edit" onSubmit={save}>
          <input autoFocus maxLength={10} value={draft} placeholder="HP, GOLD, VP…" aria-label="Counter name"
            onChange={e => setDraft(e.target.value.toUpperCase())} onKeyDown={e => { if (e.key === 'Escape') setEditing(''); }} />
          <button className="btn small primary" type="submit">{editing === '+' ? 'Add' : 'Save'}</button>
          {editing !== '+' && (
            <button className="btn small danger" type="button" onClick={() => { if (confirm(`Remove ${editing} for everyone?`)) actions.removeCounter(editing); setEditing(''); }}>Remove</button>
          )}
          <button className="btn small ghost" type="button" onClick={() => setEditing('')}>✕</button>
        </form>
      )}
    </section>
  );
}
