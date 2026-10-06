import asyncio
import json
from fastapi import WebSocket

# A send that hasn't gone through in this long is a stalled client (a till that dropped off
# the network without closing its socket). It is dropped rather than allowed to hold up the
# event for every other till.
SEND_TIMEOUT_SECONDS = 2.0


class ConnectionManager:
    def __init__(self):
        self._connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        # The broadcast may already have pruned it as dead - closing twice is not an error.
        try:
            self._connections.remove(websocket)
        except ValueError:
            pass

    async def _send(self, ws: WebSocket, payload: str) -> bool:
        try:
            await asyncio.wait_for(ws.send_text(payload), timeout=SEND_TIMEOUT_SECONDS)
            return True
        except Exception:
            return False

    async def broadcast(self, event: str):
        """Send { "type": event } to every live connection at once - one slow or stalled till
        can no longer delay the others. Sockets that fail or time out are pruned."""
        payload = json.dumps({"type": event})
        targets = list(self._connections)
        if not targets:
            return
        results = await asyncio.gather(*(self._send(ws, payload) for ws in targets))
        for ws, ok in zip(targets, results):
            if not ok:
                self.disconnect(ws)


manager = ConnectionManager()
