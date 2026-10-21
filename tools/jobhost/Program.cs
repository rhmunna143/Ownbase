using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Ownbase.JobHost
{
    class Program
    {
        #region Win32 API Definitions

        private const uint INFINITE = 0xFFFFFFFF;
        private const uint CREATE_SUSPENDED = 0x00000004;
        private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
        private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
        private const uint STARTF_USESTDHANDLES = 0x00000100;

        private const int STD_INPUT_HANDLE = -10;
        private const int STD_OUTPUT_HANDLE = -11;
        private const int STD_ERROR_HANDLE = -12;

        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
        private const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
        private const uint JOB_OBJECT_LIMIT_PROCESS_MEMORY = 0x00000100;

        private const uint JOB_OBJECT_CPU_RATE_CONTROL_ENABLE = 0x00000001;
        private const uint JOB_OBJECT_CPU_RATE_CONTROL_WEIGHT_BASED = 0x00000002;
        private const uint JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP = 0x00000004;

        private const uint CTRL_C_EVENT = 0;
        private const uint CTRL_BREAK_EVENT = 1;

        public enum JobObjectInfoClass
        {
            JobObjectBasicAccountingInformation = 1,
            JobObjectBasicLimitInformation = 2,
            JobObjectBasicProcessIdList = 3,
            JobObjectBasicUIRestrictions = 4,
            JobObjectSecurityLimitInformation = 5,
            JobObjectEndOfJobTimeInformation = 6,
            JobObjectAssociateCompletionPortInformation = 7,
            JobObjectBasicAndIoAccountingInformation = 8,
            JobObjectExtendedLimitInformation = 9,
            JobObjectJobSetInformation = 10,
            JobObjectGroupInformation = 11,
            JobObjectNotificationLimitInformation = 12,
            JobObjectLimitViolationInformation = 13,
            JobObjectGroupInformationEx = 14,
            JobObjectCpuRateControlInformation = 15,
            JobObjectCompletionFilter = 16,
            JobObjectCompletionCounter = 17,
            JobObjectReserved1Information = 18,
            JobObjectReserved2Information = 19,
            JobObjectReserved3Information = 20,
            JobObjectReserved4Information = 21,
            JobObjectReserved5Information = 22,
            JobObjectReserved6Information = 23,
            JobObjectReserved7Information = 24,
            JobObjectReserved8Information = 25,
            JobObjectReserved9Information = 26,
            JobObjectReserved10Information = 27,
            JobObjectReserved11Information = 28,
            JobObjectReserved12Information = 29,
            JobObjectReserved13Information = 30,
            JobObjectReserved14Information = 31,
            JobObjectNetRateControlInformation = 32,
            JobObjectNotificationLimitInformation2 = 33,
            JobObjectLimitViolationInformation2 = 34,
            JobObjectCreateSilo = 35,
            JobObjectSiloBasicInformation = 36,
            JobObjectReserved15Information = 37,
            JobObjectReserved16Information = 38,
            JobObjectReserved17Information = 39,
            JobObjectReserved18Information = 40,
            JobObjectReserved19Information = 41,
            JobObjectReserved20Information = 42,
            JobObjectReserved21Information = 43,
            JobObjectReserved22Information = 44,
            JobObjectReserved23Information = 45,
            JobObjectReserved24Information = 46,
            JobObjectReserved25Information = 47,
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryLimit;
            public UIntPtr PeakJobMemoryLimit;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_CPU_RATE_CONTROL_INFORMATION
        {
            public uint ControlFlags;
            public uint CpuRate; // e.g. 2500 for 25.00%
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
        {
            public long TotalUserTime;
            public long TotalKernelTime;
            public long ThisPeriodTotalUserTime;
            public long ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount;
            public uint TotalProcesses;
            public uint ActiveProcesses;
            public uint TotalTerminatedProcesses;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool SetInformationJobObject(
            IntPtr hJob,
            JobObjectInfoClass JobObjectInformationClass,
            IntPtr lpJobObjectInformation,
            uint cbJobObjectInformationLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool QueryInformationJobObject(
            IntPtr hJob,
            JobObjectInfoClass JobObjectInformationClass,
            IntPtr lpJobObjectInformation,
            uint cbJobObjectInformationLength,
            out uint lpReturnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool CreateProcess(
            string lpApplicationName,
            StringBuilder lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint ResumeThread(IntPtr hThread);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr GetStdHandle(int nStdHandle);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);

        #endregion

        private static IntPtr _hJob = IntPtr.Zero;
        private static PROCESS_INFORMATION _pi;
        private static bool _childStarted = false;
        private static int _targetPid = 0;

        static int Main(string[] args)
        {
            if (args.Length == 0 || args[0] == "--help" || args[0] == "-h")
            {
                Console.WriteLine("Ownbase Job Host Launcher (Win32 Job Object Supervisor)");
                Console.WriteLine("Usage: ownbase-jobhost.exe [options] -- <executable> [arguments...]");
                Console.WriteLine("Options:");
                Console.WriteLine("  --memory-mb <MB>        Limit total committed memory for the job tree");
                Console.WriteLine("  --cpu-limit <PCT>       Limit CPU rate percentage (1-100) hard cap");
                Console.WriteLine("  --kill-on-close         Terminate entire process tree when job handle closes");
                Console.WriteLine("  --cwd <DIR>             Working directory for target process");
                Console.WriteLine("  --env-file <FILE>       Path to environment variables file (key=val)");
                Console.WriteLine("  --metrics-interval <MS> Interval in milliseconds for metrics reporting");
                Console.WriteLine("  --job-name <NAME>       Name for the job object");
                return 0;
            }

            int memoryMb = 0;
            int cpuLimitPct = 0;
            bool killOnClose = false;
            string cwd = null;
            string envFile = null;
            int metricsInterval = 0;
            string jobName = null;

            int dashDashIndex = -1;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--")
                {
                    dashDashIndex = i;
                    break;
                }
                if (args[i] == "--memory-mb" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out memoryMb);
                }
                else if (args[i] == "--cpu-limit" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out cpuLimitPct);
                }
                else if (args[i] == "--kill-on-close")
                {
                    killOnClose = true;
                }
                else if (args[i] == "--cwd" && i + 1 < args.Length)
                {
                    cwd = args[++i];
                }
                else if (args[i] == "--env-file" && i + 1 < args.Length)
                {
                    envFile = args[++i];
                }
                else if (args[i] == "--metrics-interval" && i + 1 < args.Length)
                {
                    int.TryParse(args[++i], out metricsInterval);
                }
                else if (args[i] == "--job-name" && i + 1 < args.Length)
                {
                    jobName = args[++i];
                }
            }

            if (dashDashIndex == -1 || dashDashIndex + 1 >= args.Length)
            {
                Console.Error.WriteLine("[JOBHOST-ERR] Target executable must be specified after '--'");
                return 1;
            }

            string targetExecutable = args[dashDashIndex + 1];
            List<string> targetArgs = new List<string>();
            for (int i = dashDashIndex + 2; i < args.Length; i++)
            {
                targetArgs.Add(args[i]);
            }

            // Create Win32 Job Object
            string jobObjName = string.IsNullOrEmpty(jobName) 
                ? "OwnbaseJob_" + Process.GetCurrentProcess().Id + "_" + Guid.NewGuid().ToString("N").Substring(0, 8) 
                : jobName;

            _hJob = CreateJobObject(IntPtr.Zero, null);
            if (_hJob == IntPtr.Zero)
            {
                int err = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("[JOBHOST-ERR] Failed to create Job Object. Win32 Error: " + err);
                return 1;
            }

            // Configure Limits
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION extLimits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            uint limitFlags = 0;

            if (killOnClose)
            {
                limitFlags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            }

            if (memoryMb > 0)
            {
                limitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
                ulong bytes = (ulong)memoryMb * 1024 * 1024;
                extLimits.JobMemoryLimit = new UIntPtr(bytes);
            }

            extLimits.BasicLimitInformation.LimitFlags = limitFlags;

            int structSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr pLimits = Marshal.AllocHGlobal(structSize);
            try
            {
                Marshal.StructureToPtr(extLimits, pLimits, false);
                if (!SetInformationJobObject(_hJob, JobObjectInfoClass.JobObjectExtendedLimitInformation, pLimits, (uint)structSize))
                {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine("[JOBHOST-ERR] Failed to set extended Job Object limits. Win32 Error: " + err);
                    return 1;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(pLimits);
            }

            // Configure CPU rate control limit if requested
            if (cpuLimitPct > 0)
            {
                if (cpuLimitPct > 100) cpuLimitPct = 100;
                JOBOBJECT_CPU_RATE_CONTROL_INFORMATION cpuInfo = new JOBOBJECT_CPU_RATE_CONTROL_INFORMATION();
                cpuInfo.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
                cpuInfo.CpuRate = (uint)(cpuLimitPct * 100); // 100 * percent

                int cpuStructSize = Marshal.SizeOf(typeof(JOBOBJECT_CPU_RATE_CONTROL_INFORMATION));
                IntPtr pCpuInfo = Marshal.AllocHGlobal(cpuStructSize);
                try
                {
                    Marshal.StructureToPtr(cpuInfo, pCpuInfo, false);
                    if (!SetInformationJobObject(_hJob, JobObjectInfoClass.JobObjectCpuRateControlInformation, pCpuInfo, (uint)cpuStructSize))
                    {
                        int err = Marshal.GetLastWin32Error();
                        Console.Error.WriteLine("[JOBHOST-WARN] SetInformationJobObject for CPU rate control returned Win32 Error: " + err);
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(pCpuInfo);
                }
            }

            // Build Command Line string
            StringBuilder cmdLine = new StringBuilder();
            if (targetExecutable.Contains(" ") && !targetExecutable.StartsWith("\""))
            {
                cmdLine.Append("\"").Append(targetExecutable).Append("\"");
            }
            else
            {
                cmdLine.Append(targetExecutable);
            }

            foreach (var a in targetArgs)
            {
                cmdLine.Append(" ");
                if (a.Contains(" ") && !a.StartsWith("\""))
                {
                    cmdLine.Append("\"").Append(a).Append("\"");
                }
                else
                {
                    cmdLine.Append(a);
                }
            }

            // Setup Startup Info
            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.dwFlags = (int)STARTF_USESTDHANDLES;
            si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            si.hStdError = GetStdHandle(STD_ERROR_HANDLE);

            uint creationFlags = CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP;

            // Load extra environment variables if specified
            if (!string.IsNullOrEmpty(envFile) && File.Exists(envFile))
            {
                try
                {
                    string[] lines = File.ReadAllLines(envFile);
                    foreach (var line in lines)
                    {
                        if (string.IsNullOrEmpty(line) || line.StartsWith("#")) continue;
                        int eq = line.IndexOf('=');
                        if (eq > 0)
                        {
                            string k = line.Substring(0, eq).Trim();
                            string v = line.Substring(eq + 1).Trim();
                            Environment.SetEnvironmentVariable(k, v);
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("[JOBHOST-WARN] Could not parse env-file: " + ex.Message);
                }
            }

            if (string.IsNullOrEmpty(cwd) || !Directory.Exists(cwd))
            {
                cwd = Environment.CurrentDirectory;
            }

            // Create child process suspended
            bool created = CreateProcess(
                null,
                cmdLine,
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                creationFlags,
                IntPtr.Zero,
                cwd,
                ref si,
                out _pi);

            if (!created)
            {
                int err = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("[JOBHOST-ERR] CreateProcess failed for " + targetExecutable + ". Win32 Error: " + err);
                CloseHandle(_hJob);
                return 1;
            }

            _targetPid = _pi.dwProcessId;

            // Assign process to Job Object BEFORE resuming thread
            if (!AssignProcessToJobObject(_hJob, _pi.hProcess))
            {
                int err = Marshal.GetLastWin32Error();
                Console.Error.WriteLine("[JOBHOST-ERR] AssignProcessToJobObject failed. Win32 Error: " + err);
                TerminateJobObject(_hJob, 1);
                CloseHandle(_pi.hProcess);
                CloseHandle(_pi.hThread);
                CloseHandle(_hJob);
                return 1;
            }

            // Setup console cancel event
            Console.CancelKeyPress += (sender, e) =>
            {
                e.Cancel = true;
                StopChildGracefully();
            };

            // Start thread listening to stdin for command signals
            Thread stdinThread = new Thread(ListenStdin);
            stdinThread.IsBackground = true;
            stdinThread.Start();

            // Resume the child process
            ResumeThread(_pi.hThread);
            _childStarted = true;

            // Emit structured started event
            Console.WriteLine("[JOBHOST] {\"event\":\"started\",\"pid\":" + _targetPid + ",\"jobName\":\"" + jobObjName + "\",\"limits\":{\"memoryMb\":" + memoryMb + ",\"cpuLimitPct\":" + cpuLimitPct + "}}");

            // Start metrics reporting thread if interval > 0
            Thread metricsThread = null;
            if (metricsInterval > 0)
            {
                metricsThread = new Thread(() => RunMetricsLoop(metricsInterval));
                metricsThread.IsBackground = true;
                metricsThread.Start();
            }

            // Wait for process exit
            WaitForSingleObject(_pi.hProcess, INFINITE);

            uint exitCode = 0;
            GetExitCodeProcess(_pi.hProcess, out exitCode);

            // Report exit event
            Console.WriteLine("[JOBHOST] {\"event\":\"exited\",\"exitCode\":" + exitCode + ",\"pid\":" + _targetPid + "}");

            CloseHandle(_pi.hThread);
            CloseHandle(_pi.hProcess);
            CloseHandle(_hJob);

            return (int)exitCode;
        }

        private static void StopChildGracefully()
        {
            try
            {
                if (_pi.hProcess != IntPtr.Zero && _targetPid > 0)
                {
                    GenerateConsoleCtrlEvent(CTRL_BREAK_EVENT, (uint)_targetPid);
                    // Give grace period of 1500ms before hard terminating job
                    if (WaitForSingleObject(_pi.hProcess, 1500) != 0)
                    {
                        if (_hJob != IntPtr.Zero)
                        {
                            TerminateJobObject(_hJob, 1);
                        }
                    }
                }
            }
            catch {}
        }

        private static void ListenStdin()
        {
            try
            {
                string line;
                while ((line = Console.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line.Equals("STOP", StringComparison.OrdinalIgnoreCase) ||
                        line.Contains("\"cmd\":\"stop\"") ||
                        line.Contains("\"command\":\"stop\""))
                    {
                        StopChildGracefully();
                        break;
                    }
                }
            }
            catch {}
        }

        private static void RunMetricsLoop(int intervalMs)
        {
            int basicSize = Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            int extSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));

            IntPtr pBasic = Marshal.AllocHGlobal(basicSize);
            IntPtr pExt = Marshal.AllocHGlobal(extSize);

            try
            {
                while (_childStarted && _hJob != IntPtr.Zero)
                {
                    Thread.Sleep(intervalMs);

                    uint returnLen;
                    bool okBasic = QueryInformationJobObject(_hJob, JobObjectInfoClass.JobObjectBasicAccountingInformation, pBasic, (uint)basicSize, out returnLen);
                    bool okExt = QueryInformationJobObject(_hJob, JobObjectInfoClass.JobObjectExtendedLimitInformation, pExt, (uint)extSize, out returnLen);

                    if (okBasic && okExt)
                    {
                        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION basic = (JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)Marshal.PtrToStructure(pBasic, typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
                        JOBOBJECT_EXTENDED_LIMIT_INFORMATION ext = (JOBOBJECT_EXTENDED_LIMIT_INFORMATION)Marshal.PtrToStructure(pExt, typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));

                        // 100-nanosecond intervals to milliseconds:
                        long cpuTimeMs = (basic.TotalUserTime + basic.TotalKernelTime) / 10000;
                        ulong memBytes = (ulong)ext.JobMemoryLimit.ToUInt64(); // configured
                        ulong peakMemBytes = (ulong)ext.PeakJobMemoryLimit.ToUInt64();

                        Console.WriteLine("[JOBHOST] {\"event\":\"metrics\",\"pid\":" + _targetPid + ",\"activeProcesses\":" + basic.ActiveProcesses + ",\"cpuTimeMs\":" + cpuTimeMs + ",\"peakMemoryBytes\":" + peakMemBytes + "}");
                    }
                }
            }
            catch {}
            finally
            {
                Marshal.FreeHGlobal(pBasic);
                Marshal.FreeHGlobal(pExt);
            }
        }
    }
}
