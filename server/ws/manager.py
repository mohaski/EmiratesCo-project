import json
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self._connections.remove(websocket)

    async def broadcast(self, event: str):
        """Send { "type": event } to all live connections. Dead sockets are pruned."""
        payload = json.dumps({"type": event})
        dead: list[WebSocket] = []
        for ws in list(self._connections):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.discard(ws) if hasattr(self._connections, "discard") else None
            try:
                self._connections.remove(ws)
            except ValueError:
                pass


manager = ConnectionManager()
