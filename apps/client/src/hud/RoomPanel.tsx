// Top left: the rune (click to copy an invite link) and who's in your party.
import { SEAT_COLORS } from '@kitforge/shared-types';
import { leaveTable } from '../net/connection.ts';
import { copyInvite } from '../net/invite.ts';
import { actions } from '../pieces/actions.ts';
import { useTable } from '../net/tableStore.ts';

export function RoomPanel() {
  const t = useTable();
  const state = t.state;
  if (!state) return null;
  const players = [...state.players.values()].sort((a, b) => a.seat - b.seat);
  const counters = [...state.counterNames];
  const addCounter = () => { const n = prompt('New counter for every player (e.g. HP, GOLD, VP):'); if (n?.trim()) actions.addCounter(n); };
  const copy = () => void copyInvite(state.roomCode, text => t.notify(text));

  return (
    <section className="hud-panel room-panel">
      <div className="room-row">
        <button className="room-code" onClick={copy} title="Copy an invite link">{state.roomCode}</button>
        <button className="btn small" onClick={copy} title="Copy a link that opens this table">🔗 Invite</button>
        <button className="btn small ghost" onClick={() => void leaveTable()} title="Leave the table">Leave</button>
      </div>
      <p className="party-label">PARTY · {players.length} player{players.length === 1 ? '' : 's'}</p>
      <table className="players">
        <thead>
          <tr>
            <th />
            {counters.map(k => (
              <th key={k}><button className="counter-name" title={`Remove the ${k} counter`} onClick={() => { if (confirm(`Remove the ${k} counter for everyone?`)) actions.removeCounter(k); }}>{k}</button></th>
            ))}
            <th>{counters.length < 4 && <button className="counter-name add" title="Add a counter" onClick={addCounter}>＋</button>}</th>
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
                      <output title="Tap to type a number" onClick={() => { const n = prompt(`${p.name}'s ${k}:`, String(v)); if (n !== null && n.trim() !== '' && Number.isFinite(Number(n))) actions.setCounter(p.id, k, Number(n)); }}>{v}</output>
                      <button onClick={() => actions.counter(p.id, k, 1)} aria-label={`${p.name} ${k} plus`}>+</button>
                    </div>
                  </td>
                );
              })}
              <td />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
