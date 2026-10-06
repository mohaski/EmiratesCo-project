from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from .manager import manager

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive; client can send "ping" — we ignore content
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        # A connection reset or any other socket error: the client is gone either way.
        pass
    finally:
        manager.disconnect(websocket)
