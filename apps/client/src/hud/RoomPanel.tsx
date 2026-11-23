// Top left: the rune (click to copy an invite link) and who's in your party.
import { useState, type FormEvent } from 'react';
import { MAX_COUNTERS, seatColor } from '@kitforge/shared-types';
import type { SyncedPlayer } from '../net/stateTypes.ts';
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
  const everyone = [...state.players.values()];
  const players = everyone.filter(p => !p.spectator).sort((a, b) => a.seat - b.seat);
  const watchers = everyone.filter(p => p.spectator).sort((a, b) => a.name.localeCompare(b.name));
  const counters = [...state.counterNames];
  const bans = [...state.bans];
  // Spectators see the scores but can't change them (the server would refuse anyway).
  const readOnly = t.isSpectator();
  const staff = t.isStaff();
  // Host/co-host tools for one person: co-host star (host only), remove, ban. Never on yourself or the host.
  const manage = (p: SyncedPlayer) => {
    const other = p.id !== t.playerId && p.id !== state.hostId;
    return (
      <>
        {t.isHost() && !p.spectator && p.id !== t.playerId && (
          <button className={`icon-btn star ${p.promoted ? 'on' : ''}`} aria-pressed={p.promoted}
            title={p.promoted ? `${p.name} is a co-host — click to take it back` : `Make ${p.name} a co-host (can remove, ban and clear the table)`}
            onClick={() => actions.promote(p.id, !p.promoted)}>{p.promoted ? '⭐' : '☆'}</button>
        )}
        {staff && other && (
          <button className="icon-btn" title={`Remove ${p.name}`} onClick={() => { if (confirm(`Remove ${p.name} from the table?`)) actions.kick(p.id); }}>✕</button>
        )}
        {staff && other && (
          <button className="icon-btn" title={`Remove ${p.name} and stop that name rejoining`}
            onClick={() => { if (confirm(`Ban ${p.name}? They're removed now and can't rejoin under the name "${p.name}".`)) actions.ban(p.id); }}>🚫</button>
        )}
      </>
    );
  };
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
        <p className="party-label">PARTY · {players.length} player{players.length === 1 ? '' : 's'}{readOnly ? ' · 👁 you are watching' : ''}</p>
        <span className="muted small">COUNTERS</span>
        <span className="counter-count">
                <button className="counter-name add" title="Remove the last counter" disabled={readOnly || counters.length === 0}
                  onClick={() => { const last = counters[counters.length - 1]; if (last && confirm(`Remove ${last} for everyone?`)) actions.removeCounter(last); }}>−</button>
                <button className="counter-name add" title="Add a point counter" disabled={readOnly || counters.length >= MAX_COUNTERS} onClick={() => edit('+')}>＋</button>
              </span>
      </div>
      <div className="players-scroll"><table className="players">
        <thead>
          <tr>
            <th />
            {counters.map(k => (
              <th key={k}><button className="counter-name" title={`Rename or remove ${k}`} disabled={readOnly} onClick={() => edit(k)}>{k}{readOnly ? '' : ' ✎'}</button></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map(p => (
            <tr key={p.id} className={p.connected ? '' : 'away'}>
              <td className="who">
                <i className="dot" style={{ background: seatColor(p.seat) }} />
                <b>{p.name}</b>
                {p.id === state.hostId && <span title="Host">👑</span>}
                {p.promoted && p.id !== state.hostId && <span title="Co-host">⭐</span>}
                {p.id === t.playerId && <span className="muted you">(you)</span>}
                {!p.connected && <span className="muted">away</span>}
                {manage(p)}
              </td>
              {counters.map(k => {
                const v = p.counters.get(k) ?? 0;
                return (
                  <td key={k}>
                    <div className="counter">
                      <button disabled={readOnly} onClick={() => actions.counter(p.id, k, -1)} aria-label={`${p.name} ${k} minus`}>−</button>
                      {typing === `${p.id}:${k}` && !readOnly ? (
                        <input className="counter-input" type="number" inputMode="numeric" autoFocus defaultValue={v} aria-label={`${p.name} ${k}`}
                          onBlur={e => { const n = Number(e.currentTarget.value); if (e.currentTarget.value.trim() !== '' && Number.isFinite(n)) actions.setCounter(p.id, k, n); setTyping(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setTyping(''); }} />
                      ) : (
                        <output title={readOnly ? undefined : 'Tap to type a number'} onClick={() => { if (!readOnly) setTyping(`${p.id}:${k}`); }}>{v}</output>
                      )}
                      <button disabled={readOnly} onClick={() => actions.counter(p.id, k, 1)} aria-label={`${p.name} ${k} plus`}>+</button>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
      {watchers.length > 0 && (
        <div className="watchers">
          <p className="party-label">👁 WATCHING · {watchers.length}</p>
          <ul className="watcher-list">
            {watchers.map(p => (
              <li key={p.id} className={`who ${p.connected ? '' : 'away'}`}>
                <span title="Watching without a seat">👁</span>
                <b>{p.name}</b>
                {p.id === t.playerId && <span className="muted you">(you)</span>}
                {!p.connected && <span className="muted">away</span>}
                {manage(p)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {staff && bans.length > 0 && (
        <div className="bans">
          <p className="party-label">🚫 BANNED NAMES · {bans.length}</p>
          <ul className="watcher-list">
            {bans.map(name => (
              <li key={name} className="who">
                <b>{name}</b>
                <button className="btn small ghost" title={`Let "${name}" join this table again`} onClick={() => actions.unban(name)}>Unban</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {editing && !readOnly && (
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
