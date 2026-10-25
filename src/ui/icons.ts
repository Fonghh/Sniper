// Inline SVG icons (stroke uses currentColor so buttons can tint them).

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  scope: svg('<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  // Shows the stance you switch TO.
  prone: svg('<circle cx="5" cy="13" r="2"/><path d="M8 15h10l3 2M10 15l2-3h5"/><path d="M3 18h18"/>'),
  stand: svg('<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M12 14l-3 7M12 14l3 7M8 10h8"/>'),
  track: svg(
    '<path d="M8.5 4c1.6 0 2.5 2.6 2.5 5.5S10 15 8.5 15 6 12.4 6 9.5 6.9 4 8.5 4z"/><path d="M15.5 4c1.6 0 2.5 2.6 2.5 5.5S17 15 15.5 15 13 12.4 13 9.5 13.9 4 15.5 4z"/><path d="M8 18.5h1M15 18.5h1"/>',
  ),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
} as const;
