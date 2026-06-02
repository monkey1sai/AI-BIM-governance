"""Shared pytest bootstrap for the repo-root test suite.

Centralizes the cross-package import path so individual test modules no longer
each mutate ``sys.path``. pytest auto-loads this file, so importing
``tests``-local packages (e.g. ``fakes``) works without per-module shims.
"""

import sys
from pathlib import Path

TESTS_ROOT = Path(__file__).parent
REPO_ROOT = TESTS_ROOT.parent

if str(TESTS_ROOT) not in sys.path:
    sys.path.insert(0, str(TESTS_ROOT))
