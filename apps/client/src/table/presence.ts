// Whether this tab shares its pointer with the table. Local only (P toggles it): the server just
// sees your pointer go hidden, and nobody else is told why.
import { actions } from '../pieces/actions.ts';
import { store } from '../net/tableStore.ts';

let sharing = true;

export const presence = {
  get sharing() { return sharing; },
  toggle() {
    sharing = !sharing;
    if (!sharing) actions.point();
    store.notify(sharing ? 'Your pointer is visible to the table again.' : 'Your pointer is hidden from the table. Press P to show it.');
  },
};
