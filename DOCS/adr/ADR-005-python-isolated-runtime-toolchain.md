# ADR-005: Isolated Python Runtime via python-build-standalone (Spike S5)

**Status:** Accepted (Spike S5: PASS)  
**Date:** October 19, 2026  
**Deciders:** Core Engineering Team  
**Consulted:** `UPGRADE_PRD.md` Section 3.2 (Decisions D1, D12), Spike S5

---

## Context and Problem Statement
To support deploying Python applications (FastAPI, Flask, AI agents, Streamlit) natively on Windows without requiring users to manually install Python or configure system PATHs, Ownbase must provide a self-contained portable Python runtime.
We evaluated two candidate packaging approaches:
1. **Official Python Windows Embeddable Package (`python-x.y.z-embed-amd64.zip`):** Small download (~10 MB), but ships with `python._pth` file disabling `site-packages`, lacks `pip`, `ensurepip`, `distutils`, and cannot create standard `venv` environments without heavy binary hacks.
2. **`python-build-standalone` (Gregory Szorc / Astral `install_only` releases):** Self-contained, relocatable CPython build for Windows x64 with full standard library, preinstalled `pip`, and native `venv` module support.

## Decision
We adopt **`python-build-standalone`** (flavor `install_only`, Windows x64) as the managed Python runtime for the deployment engine:
- Downloaded and cached on-demand in `%ProgramData%\Ownbase\runtimes\python-3.11-x64\`.
- Deployed apps create isolated virtual environments via `python -m venv .venv`.
- Dependencies installed per application via `.venv\Scripts\pip.exe install -r requirements.txt`.
- Fully isolated from any host Python installations; zero pollution of system PATH.

## Spike S5 Evaluation Results
- **Test:** Downloaded portable `cpython-3.11.x-x86_64-pc-windows-msvc-install_only.tar.gz`. Extracted into a local subdirectory and moved the directory to a new path to test relocatability.
- **Verification:**
  1. Ran `python.exe -m venv .test_venv` in a relocatable directory.
  2. Activated virtual environment and executed `.test_venv\Scripts\pip install requests fastapi uvicorn`.
  3. Ran test HTTP server using `uvicorn` and queried endpoint via loopback.
  4. Verified embeddable zip failed this test (embeddable zip fails with `No module named pip` and cannot build venvs).
- **Result:** **PASS.**

## Consequences
- **Positive:** Reliable, standard Python environment that works identically across all Windows 10/11 machines. Fully compatible with wheel binaries and native C extensions.
- **Negative:** Download size is larger than embeddable zip (~40 MB compressed, ~120 MB uncompressed).
- **Fallback:** If offline or download fails, fallback to NuGet `python` package or prompt user for existing system Python.
