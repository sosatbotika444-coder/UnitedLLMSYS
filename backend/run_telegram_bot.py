from __future__ import annotations

import asyncio
import logging
import sys

from app.telegram_polling import run_polling_bot


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, stream=sys.stdout)
    asyncio.run(run_polling_bot())
