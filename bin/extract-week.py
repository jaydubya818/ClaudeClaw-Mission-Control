#!/usr/bin/env python3
"""One-shot: run the memory extractor over the last 7 days of hive_mind.

Used to backfill memories from older agent activity that the regular
30-min cron window has already passed by.
"""
import os, sys, pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import memory.extractor as ex
ex.WINDOW_SECONDS = int(os.environ.get("WINDOW_SECONDS", 7 * 24 * 60 * 60))
sys.exit(ex.main())
