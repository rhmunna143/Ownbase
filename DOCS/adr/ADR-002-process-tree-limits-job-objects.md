# ADR-002: Process Tree Limits and Clean Termination via Windows Job Objects (Spike S2)

**Status:** Accepted (Spike S2: PASS)  
**Date:** October 19, 2026  
**Deciders:** Core Engineering Team  
**Consulted:** `UPGRADE_PRD.md` Section 3.2 (Decision D4), Spike S2

---

## Context and Problem Statement
In the prototype, services and deployed apps are spawned using Node.js `child_process.spawn()`. This has two fatal limitations on Windows:
1. **Unbounded Resource Usage:** A deployed app (e.g. Python or Node worker) can spawn child processes that allocate unbounded memory and 100% CPU, starving the host operating system. Node's `child_process` offers no built-in mechanism to cap memory or CPU on Windows.
2. **Zombie / Orphaned Process Trees:** When a parent service is terminated, grandchild processes remain running in the background. `taskkill /pid <PID> /T /F` attempts to clean up, but races if children spawn grandchildren dynamically during termination.

## Decision
We adopt **Windows Job Objects** via a dedicated lightweight Go launcher executable (`ownbase-jobhost.exe`), with `koffi` FFI as an in-process secondary integration:
- Uses `CreateJobObjectW` with `JOB_OBJECT_LIMIT_JOB_MEMORY` (capping the total commit charge of the entire process tree) and `JOB_OBJECT_LIMIT_CPU_RATE_CONTROL` (hard capping CPU cycles).
- Sets `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: when the job handle is closed (or when the host daemon crashes/terminates), the Windows kernel automatically and atomically terminates every process in the job tree.
- Uses `CreateProcessW` with `CREATE_SUSPENDED`, assigns the initial process to the Job Object via `AssignProcessToJobObject`, and calls `ResumeThread`. This completely eliminates the race condition where a child spawns grandchildren before being assigned to the job.

## Spike S2 Evaluation Results
- **Test:** A test harness process spawned a child that in turn spawned two background memory-allocating child workers. The job limit was set to 512 MB.
- **Verification:**
  1. **Tree Memory Cap:** When aggregate memory across all children reached 512 MB, Windows kernel enforced the limit and prevented OS exhaustion.
  2. **Atomic Tree Termination:** When the host process was killed (`kill -9` / `taskkill /f`), all child and grandchild worker processes immediately disappeared from the Windows process table with zero orphans.
- **Result:** **PASS.**

## Consequences
- **Positive:** Reliable, kernel-enforced sandboxing and leak-free process tree lifecycle management without Docker or Hyper-V overhead.
- **Negative:** Requires bundling a small compiled native launcher binary (`ownbase-jobhost.exe`) or loading Win32 kernel32 APIs via `koffi`.
- **Note on Scope:** Job Objects enforce resource caps (CPU, memory, process count), NOT security containment (filesystem/network). Security containment relies on NTFS ACLs and network binding rules.
