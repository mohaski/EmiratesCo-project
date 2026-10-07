// Lightweight singleton event bus for WebSocket-pushed events.
// Contexts subscribe; WebSocketContext publishes.
const _emitter = new EventTarget();

export const wsEvents = {
    // `detail`: the message's data, for the few events that carry some (bar_handed_over).
    emit: (type, detail) => _emitter.dispatchEvent(new CustomEvent(type, { detail })),
    on: (type, handler) => {
        _emitter.addEventListener(type, handler);
        return () => _emitter.removeEventListener(type, handler);
    },
};
