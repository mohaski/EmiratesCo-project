import qz from 'qz-tray';

// Chrome's --kiosk-printing flag is a long-standing broken feature (still shows the
// system print dialog on current Chrome versions — see chromium issue 339416/169004).
// QZ Tray is a local desktop agent that accepts print jobs over a websocket and sends
// them straight to the OS print spooler, skipping the browser dialog entirely. It must
// be installed and running on the till PC (system tray icon) for this to work.
const THERMAL_PRINTER_NAME = 'XP-80C';

let connectPromise = null;

function ensureConnected() {
    if (qz.websocket.isActive()) return Promise.resolve();
    if (!connectPromise) {
        connectPromise = qz.websocket.connect().catch(err => {
            connectPromise = null;
            throw err;
        });
    }
    return connectPromise;
}

// Wraps a rendered DOM node's markup as a standalone document so QZ Tray's renderer
// has the same styling context the node had on-screen (it can't see the page's
// external stylesheet, but ReceiptPage builds these tapes with inline styles).
function toStandaloneHtml(node) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { box-sizing: border-box; }
        body { margin: 0; background: #fff; }
    </style></head><body>${node.outerHTML}</body></html>`;
}

// Prints each given DOM node as its own job/slip on the thermal printer via QZ Tray.
// Throws if QZ Tray isn't reachable — callers should fall back to window.print().
export async function printTapesViaQZ(nodes) {
    await ensureConnected();
    const printer = await qz.printers.find(THERMAL_PRINTER_NAME);
    const config = qz.configs.create(printer, {
        size: { width: 80, height: null }, // null height = auto/continuous, like the CSS @page rule
        units: 'mm',
        margins: 0,
    });

    for (const node of nodes) {
        const data = [{ type: 'pixel', format: 'html', flavor: 'plain', data: toStandaloneHtml(node) }];
        await qz.print(config, data);
    }
}
