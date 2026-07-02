// Lightweight singleton event bus for WebSocket-pushed events.
// Contexts subscribe; WebSocketContext publishes.
const _emitter = new EventTarget();

export const wsEvents = {
    emit: (type) => _emitter.dispatchEvent(new CustomEvent(type)),
    on: (type, handler) => {
        _emitter.addEventListener(type, handler);
        return () => _emitter.removeEventListener(type, handler);
    },
};
