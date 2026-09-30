// Every table shortcut in one list, for the ? sheet and the manual. The keys themselves are
// handled in screens/TableScreen.tsx — add a row here whenever you add a key there.
export const HOTKEYS: { group: string; keys: [string[], string][] }[] = [
  { group: 'Pieces', keys: [
    [['F'], 'Flip'],
    [['Shift', 'F'], 'Turn all face down (again: all face up)'],
    [['Q', '/', 'E'], 'Rotate left / right'],
    [['Shift', 'Q', '/', 'E'], 'Turn 15°'],
    [['A'], 'Turn around (180°)'],
    [['T'], 'Tap / untap'],
    [['+', '/', '−'], 'Bigger / smaller'],
    [['C'], 'Clone'],
    [['Del'], 'Delete'],
  ] },
  { group: 'Stacks', keys: [
    [['R'], 'Shuffle — the stack you point at, or a selection into one stack'],
    [['G'], 'Gather the selection into one stack'],
  ] },
  { group: '3D models', keys: [
    [['U', '/', 'Shift', 'U'], 'Next / previous side up'],
    [['1'], 'Stand upright'],
    [['2'], 'Upside down'],
    [['3', '/', '4'], 'Tip over face down / face up'],
    [['5', '/', '6'], 'Tip over onto its left / right side'],
  ] },
  { group: 'Selecting', keys: [
    [['Shift', 'drag'], 'Box select on empty table — adds to the selection'],
    [['Ctrl', 'drag'], 'Box select from anywhere, even starting on a piece'],
    [['Touch', 'hold', 'drag'], 'Box select on phones and tablets — hold a finger still, then drag'],
    [['Shift', 'click'], 'Add or remove one piece'],
    [['Ctrl', 'A'], 'Select everything'],
    [['Esc'], 'Select nothing'],
  ] },
  { group: 'Table', keys: [
    [['N'], 'New note'],
    [['L'], 'Open / close the log'],
    [['H'], 'Hide / show panels'],
    [['Home'], 'Reset the camera'],
    [['Space', 'drag'], 'Pan the camera'],
    [['?'], 'This list'],
  ] },
];
