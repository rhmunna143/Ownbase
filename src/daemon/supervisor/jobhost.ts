import { spawn, ChildProcess } from 'child_process';
import { logger } from '../core/logger';
import { ResourceLimitsSpec, StopBehaviorSpec } from './spec';

let koffi: any = null;
let kernel32: any = null;

let CreateJobObjectW: any = null;
let SetInformationJobObject: any = null;
let SetInformationJobObjectCpu: any = null;
let AssignProcessToJobObject: any = null;
let QueryInformationJobObject: any = null;
let QueryInformationJobObjectExt: any = null;
let OpenProcess: any = null;
let CloseHandle: any = null;
let TerminateJobObject: any = null;
let GenerateConsoleCtrlEvent: any = null;

let JOBOBJECT_EXTENDED_LIMIT_INFORMATION: any = null;
let JOBOBJECT_BASIC_ACCOUNTING_INFORMATION: any = null;
let JOBOBJECT_CPU_RATE_CONTROL_INFORMATION: any = null;

let isWin32JobObjectsAvailable = false;

// Initialize Win32 Job Object bindings via koffi if on Windows
if (process.platform === 'win32') {
  try {
    koffi = require('koffi');
    kernel32 = koffi.load('kernel32.dll');

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
      PerProcessUserTimeLimit: 'int64',
      PerJobUserTimeLimit: 'int64',
      LimitFlags: 'uint32',
      MinimumWorkingSetSize: 'size_t',
      MaximumWorkingSetSize: 'size_t',
      ActiveProcessLimit: 'uint32',
      Affinity: 'size_t',
      PriorityClass: 'uint32',
      SchedulingClass: 'uint32',
      ReadOperationCount: 'uint64',
      WriteOperationCount: 'uint64',
      OtherOperationCount: 'uint64',
      ReadTransferCount: 'uint64',
      WriteTransferCount: 'uint64',
      OtherTransferCount: 'uint64',
      ProcessMemoryLimit: 'size_t',
      JobMemoryLimit: 'size_t',
      PeakProcessMemoryLimit: 'size_t',
      PeakJobMemoryLimit: 'size_t',
    });

    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION = koffi.struct('JOBOBJECT_BASIC_ACCOUNTING_INFORMATION', {
      TotalUserTime: 'int64',
      TotalKernelTime: 'int64',
      ThisPeriodTotalUserTime: 'int64',
      ThisPeriodTotalKernelTime: 'int64',
      TotalPageFaultCount: 'uint32',
      TotalProcesses: 'uint32',
      ActiveProcesses: 'uint32',
      TotalTerminatedProcesses: 'uint32',
    });

    JOBOBJECT_CPU_RATE_CONTROL_INFORMATION = koffi.struct('JOBOBJECT_CPU_RATE_CONTROL_INFORMATION', {
      ControlFlags: 'uint32',
      CpuRate: 'uint32',
    });

    CreateJobObjectW = kernel32.func('CreateJobObjectW', 'void*', ['void*', 'str16']);
    SetInformationJobObject = kernel32.func('SetInformationJobObject', 'bool', [
      'void*',
      'int',
      koffi.pointer(JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
      'uint32',
    ]);
    SetInformationJobObjectCpu = kernel32.func('SetInformationJobObject', 'bool', [
      'void*',
      'int',
      koffi.pointer(JOBOBJECT_CPU_RATE_CONTROL_INFORMATION),
      'uint32',
    ]);
    AssignProcessToJobObject = kernel32.func('AssignProcessToJobObject', 'bool', ['void*', 'void*']);
    QueryInformationJobObject = kernel32.func('QueryInformationJobObject', 'bool', [
      'void*',
      'int',
      koffi.out(koffi.pointer(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)),
      'uint32',
      koffi.out(koffi.pointer('uint32')),
    ]);
    QueryInformationJobObjectExt = kernel32.func('QueryInformationJobObject', 'bool', [
      'void*',
      'int',
      koffi.out(koffi.pointer(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)),
      'uint32',
      koffi.out(koffi.pointer('uint32')),
    ]);
    OpenProcess = kernel32.func('OpenProcess', 'void*', ['uint32', 'bool', 'uint32']);
    CloseHandle = kernel32.func('CloseHandle', 'bool', ['void*']);
    TerminateJobObject = kernel32.func('TerminateJobObject', 'bool', ['void*', 'uint32']);
    GenerateConsoleCtrlEvent = kernel32.func('GenerateConsoleCtrlEvent', 'bool', ['uint32', 'uint32']);

    isWin32JobObjectsAvailable = true;
  } catch (err: any) {
    logger.warn('supervisor', `Win32 Job Object initialization notice: ${err.message}`);
  }
}

export interface JobMetrics {
  pid: number;
  activeProcesses: number;
  cpuTimeMs: number;
  peakMemoryBytes: number;
  currentMemoryBytes: number;
}

export interface SpawnJobOptions {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  limits?: ResourceLimitsSpec;
  killOnClose?: boolean;
  stopBehavior?: StopBehaviorSpec;
}

export class ManagedJob {
  public readonly child: ChildProcess;
  public readonly pid: number;
  private jobHandle: any = null;
  private previousCpuTimeMs: number = 0;
  private previousSampleTime: number = Date.now();

  constructor(child: ChildProcess, jobHandle: any) {
    this.child = child;
    this.pid = child.pid!;
    this.jobHandle = jobHandle;
  }

  public get isJobObjectActive(): boolean {
    return !!this.jobHandle;
  }

  public getMetrics(): JobMetrics | null {
    if (!this.jobHandle || !isWin32JobObjectsAvailable) {
      return null;
    }

    try {
      const basicAcct: any = {};
      const retLen = [0];
      const okBasic = QueryInformationJobObject(
        this.jobHandle,
        1, // JobObjectBasicAccountingInformation
        basicAcct,
        koffi.sizeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION),
        retLen
      );

      const extLimits: any = {};
      const okExt = QueryInformationJobObjectExt
        ? QueryInformationJobObjectExt(
            this.jobHandle,
            9, // JobObjectExtendedLimitInformation
            extLimits,
            koffi.sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION),
            retLen
          )
        : false;

      if (okBasic && okExt) {
        const totalCpuTimeMs = Math.round(
          Number((BigInt(basicAcct.TotalUserTime) + BigInt(basicAcct.TotalKernelTime)) / 10000n)
        );
        return {
          pid: this.pid,
          activeProcesses: basicAcct.ActiveProcesses || 1,
          cpuTimeMs: totalCpuTimeMs,
          peakMemoryBytes: Number(extLimits.PeakJobMemoryLimit || 0),
          currentMemoryBytes: Number(extLimits.JobMemoryLimit || 0),
        };
      }
    } catch (err: any) {
      // Metrics sampling non-fatal notice
    }

    return null;
  }

  public async stop(timeoutMs: number = 3000): Promise<void> {
    if (!this.child || this.child.killed) {
      this.cleanup();
      return;
    }

    // Attempt graceful Ctrl-Break on Windows
    if (isWin32JobObjectsAvailable && this.pid) {
      try {
        GenerateConsoleCtrlEvent(1, this.pid); // 1 = CTRL_BREAK_EVENT
      } catch {}
    }

    const exited = await new Promise<boolean>((resolve) => {
      let resolved = false;
      const onExit = () => {
        if (!resolved) {
          resolved = true;
          resolve(true);
        }
      };

      this.child.once('exit', onExit);

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.child.removeListener('exit', onExit);
          resolve(false);
        }
      }, timeoutMs);
    });

    if (!exited) {
      logger.warn('supervisor', `Process ${this.pid} did not exit within ${timeoutMs}ms; terminating job.`);
      if (this.jobHandle && isWin32JobObjectsAvailable) {
        try {
          TerminateJobObject(this.jobHandle, 1);
        } catch {}
      }
      try {
        this.child.kill('SIGKILL');
      } catch {}
    }

    this.cleanup();
  }

  public cleanup(): void {
    if (this.jobHandle && isWin32JobObjectsAvailable) {
      try {
        CloseHandle(this.jobHandle);
      } catch {}
      this.jobHandle = null;
    }
  }
}

/**
 * Spawns a native process and encloses it in a Win32 Job Object with resource limits.
 */
export async function spawnInJob(options: SpawnJobOptions): Promise<ManagedJob> {
  let jobHandle: any = null;

  if (isWin32JobObjectsAvailable) {
    try {
      jobHandle = CreateJobObjectW(null, null);

      if (jobHandle) {
        // Extended Limits: Memory Limit and Kill on Close
        let limitFlags = 0;
        if (options.killOnClose !== false) {
          limitFlags |= 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        }

        const maxMemoryMb = options.limits?.maxMemoryMb;
        let jobMemoryLimit = 0;
        if (maxMemoryMb && maxMemoryMb > 0) {
          limitFlags |= 0x00000200; // JOB_OBJECT_LIMIT_JOB_MEMORY
          jobMemoryLimit = maxMemoryMb * 1024 * 1024;
        }

        const limitsData = {
          PerProcessUserTimeLimit: 0,
          PerJobUserTimeLimit: 0,
          LimitFlags: limitFlags,
          MinimumWorkingSetSize: 0,
          MaximumWorkingSetSize: 0,
          ActiveProcessLimit: 0,
          Affinity: 0,
          PriorityClass: 0,
          SchedulingClass: 0,
          ReadOperationCount: 0,
          WriteOperationCount: 0,
          OtherOperationCount: 0,
          ReadTransferCount: 0,
          WriteTransferCount: 0,
          OtherTransferCount: 0,
          ProcessMemoryLimit: 0,
          JobMemoryLimit: jobMemoryLimit,
          PeakProcessMemoryLimit: 0,
          PeakJobMemoryLimit: 0,
        };

        SetInformationJobObject(
          jobHandle,
          9, // JobObjectExtendedLimitInformation
          limitsData,
          koffi.sizeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)
        );

        // CPU Rate Control Limit
        const cpuLimitPct = options.limits?.cpuLimitPct;
        if (cpuLimitPct && cpuLimitPct > 0) {
          const rateData = {
            ControlFlags: 0x00000001 | 0x00000004, // ENABLE | HARD_CAP
            CpuRate: Math.min(100, Math.max(1, cpuLimitPct)) * 100, // e.g. 2500 for 25%
          };
          if (SetInformationJobObjectCpu) {
            SetInformationJobObjectCpu(
              jobHandle,
              15, // JobObjectCpuRateControlInformation
              rateData,
              koffi.sizeof(JOBOBJECT_CPU_RATE_CONTROL_INFORMATION)
            );
          }
        }
      }
    } catch (err: any) {
      logger.warn('supervisor', `Job object configuration notice: ${err.message}`);
    }
  }

  // Spawn target process
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Assign to Job Object immediately
  if (jobHandle && child.pid && isWin32JobObjectsAvailable) {
    try {
      const PROCESS_ALL_ACCESS = 0x1fffff;
      const hProcess = OpenProcess(PROCESS_ALL_ACCESS, false, child.pid);
      if (hProcess) {
        AssignProcessToJobObject(jobHandle, hProcess);
        CloseHandle(hProcess);
      }
    } catch (err: any) {
      logger.warn('supervisor', `AssignProcessToJobObject notice for PID ${child.pid}: ${err.message}`);
    }
  }

  const managed = new ManagedJob(child, jobHandle);

  // Clean up job handle when child exits
  child.once('exit', () => {
    managed.cleanup();
  });

  return managed;
}
