#!/usr/bin/env python3
"""Reusable independent verification oracle for exam restoration runs (Axis M4).

Usage:
  python3 scripts/verify-exam-run.py [run-dir]

Defaults to `runs/yeoksam-grade3-20261103` when present. If the run directory
contains its own `verify_outputs.py`, delegates to that oracle using the run's
`.venv/bin/python` (if available) or the current Python interpreter.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    run_arg = sys.argv[1] if len(sys.argv) > 1 else "runs/yeoksam-grade3-20261103"
    run_dir = pathlib.Path(run_arg)
    if not run_dir.is_absolute():
        run_dir = (REPO_ROOT / run_dir).resolve()

    if not run_dir.exists():
        print(f"SKIP: run directory {run_dir} does not exist in this checkout.")
        return 0

    oracle = run_dir / "verify_outputs.py"
    if not oracle.exists():
        print(f"FAIL: missing independent verification oracle at {oracle}", file=sys.stderr)
        return 1

    venv_py = run_dir / ".venv" / "bin" / "python"
    py_exe = str(venv_py) if venv_py.exists() else sys.executable
    proc = subprocess.run([py_exe, str(oracle)], cwd=str(REPO_ROOT))
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
