import logging
from enum import StrEnum


LOG_FORMAT_DEBUG = "%(levelname)s:%(message)s:%(pathname)s:%(funcName)s:%(lineno)d"


class LogLevels(StrEnum):
    info = "INFO"
    warn = "WARNING"
    error = "ERROR"
    debug = "DEBUG"


def configure_logging(log_level: str = LogLevels.error):
    log_level = str(log_level).upper()
    log_levels = [level.value for level in LogLevels]

    if log_level not in log_levels:
        logging.basicConfig(level=LogLevels.error)
        return

    if log_level == LogLevels.debug:
        logging.basicConfig(level=log_level, format=LOG_FORMAT_DEBUG)
        return

    logging.basicConfig(level=log_level, format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
                        datefmt="%Y-%m-%d %H:%M:%S")

# The one logging setup for the app (main.py relies on it). Level from LOG_LEVEL (.env),
# INFO by default. It used to be hard-wired to DEBUG here - every library's debug output went
# to the service log - and main.py's own basicConfig was then a no-op.
import os  # noqa: E402

configure_logging(os.getenv("LOG_LEVEL", LogLevels.info))
logger = logging.getLogger(__name__)
