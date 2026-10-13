// How glass panel diagrams and worksheet text look on each paper: the 80mm thermal roll
// (same monospace stack as the rest of the slip) and the A4 laser sheet. Kept out of the
// component files so they stay components-only (fast refresh).
export const THERMAL_FONT = 'ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, "Courier New", monospace';
export const SHEET_FONT = '"Arial Narrow", Arial, Helvetica, sans-serif';

// Sizes in CSS px. charW: average character width as a share of the font size, used to
// decide whether a label fits inside a piece.
export const THERMAL_LOOK = {
    pad: 17, padR: 3, tagR: 6.5, tagFs: 9.5, fsId: 13, fsDim: 10, chainFs: 9.5, charW: 0.6, font: THERMAL_FONT,
    pieceFill: '#fff', cutStroke: 2, remStroke: 1, frame: 2, stageW: [3.4, 2.3, 1.5, 1.2], hatch: 5, hatchW: 1.3,
    pieceLabel: (c) => String(c.num),
};
export const SHEET_LOOK = {
    pad: 16, padR: 3, tagR: 5.6, tagFs: 7.8, fsId: 10, fsDim: 8.8, chainFs: 8.2, charW: 0.56, font: SHEET_FONT,
    pieceFill: '#e3e3e3', cutStroke: 1.1, remStroke: 0.8, frame: 1.6, stageW: [2.8, 1.9, 1.3, 1], hatch: 4.5, hatchW: 0.9,
    pieceLabel: (c) => c.id,
};
