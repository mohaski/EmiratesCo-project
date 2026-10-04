"""Slows down repeated wrong guesses (passwords, the cancel PIN).

In memory, per key: after FREE_ATTEMPTS failures inside WINDOW, every further attempt
must wait a delay that doubles per failure, up to MAX_DELAY. A success clears the key.
Never a permanent lockout — a hard lock keyed on a username would let anyone lock the
CEO out by typing wrong passwords. The app runs as a single process (start.bat), so a
module-level store is enough; a restart simply forgets the counts.
"""
import threading
import time

from fastapi import HTTPException

FREE_ATTEMPTS = 5
WINDOW = 15 * 60          # failures older than this are forgotten
BASE_DELAY = 30           # first wait after the free attempts, in seconds
MAX_DELAY = 5 * 60


class AttemptThrottle:
    def __init__(self, what: str):
        self.what = what
        self._failures: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> list[float]:
        stamps = [t for t in self._failures.get(key, []) if now - t < WINDOW]
        if stamps:
            self._failures[key] = stamps
        else:
            self._failures.pop(key, None)
        return stamps

    def wait_seconds(self, key: str) -> int:
        """How long `key` must still wait before another attempt (0 = go ahead)."""
        now = time.monotonic()
        with self._lock:
            stamps = self._recent(key, now)
            extra = len(stamps) - FREE_ATTEMPTS
            if extra < 0:
                return 0
            delay = min(BASE_DELAY * (2 ** extra), MAX_DELAY)
            return max(0, int(round(stamps[-1] + delay - now)))

    def check(self, key: str) -> None:
        """Raise 429 if `key` must wait. Call BEFORE checking the guess."""
        wait = self.wait_seconds(key)
        if wait > 0:
            raise HTTPException(
                status_code=429,
                detail=f"Too many incorrect {self.what} attempts. Try again in {wait} seconds.",
                headers={"Retry-After": str(wait)},
            )

    def failed(self, key: str) -> None:
        with self._lock:
            self._failures.setdefault(key, []).append(time.monotonic())

    def succeeded(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def reset_all(self) -> None:
        """For tests."""
        with self._lock:
            self._failures.clear()


login_throttle = AttemptThrottle("sign-in")
pin_throttle = AttemptThrottle("PIN")
