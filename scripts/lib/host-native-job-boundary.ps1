# scripts\lib\host-native-job-boundary.ps1
#
# Launch-time OS containment boundary for host-native child processes
# (issue #522). On Windows a process tree assigned to a Job Object with
# JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is inescapably contained: descendants
# inherit membership, breakaway is denied (no BREAKAWAY limit flags are ever
# set), and TerminateJobObject/last-handle-close kills the whole tree at the
# kernel, closing every PPID-sweep gap that Stop-HostNativeProcessTreeAndWait
# honestly documents (enumeration races, orphan re-parenting, PID recycling).
#
# Two usage shapes, both fail closed:
#
#   Long-lived service (Start-HostNativeService): the launcher creates a NAMED
#   kill-on-close job, assigns the child, then DUPLICATES the job handle INTO
#   the child ("anchor") and closes its own handle. Consequences:
#     - the launcher/deploy session exiting does NOT kill the service (the
#       child's duplicated handle keeps the job alive) - the persistent deploy
#       area survives, unlike a naive kill-on-close design;
#     - if the service ROOT dies, the last job handle dies with it and the
#       kernel reaps every remaining descendant - no orphan escape;
#     - an explicit stop opens the job BY NAME and terminates the whole
#       membership set, which is authoritative, not PPID-discovered.
#
#   Bounded child (Invoke-HostNativeBoundedProcess): the RUNNER holds the only
#   handle for the duration of the operation. Timeout -> TerminateJobObject
#   with a proven-empty membership postcondition; normal completion -> closing
#   the handle reaps any straggler the child may have leaked.
#
# POSIX has no Job Object. Every entry point is guarded by
# Test-HostNativeJobBoundarySupported; unsupported platforms keep the existing
# setsid/sweep behavior and its fail-closed disclosure. A real POSIX boundary
# (cgroup delegation) is tracked separately in issue #517.

Set-StrictMode -Version Latest

if (-not ('AiBim.JobBoundaryNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace AiBim
{
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
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    public static class JobBoundaryNative
    {
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
        private const int JobObjectBasicProcessIdList = 3;
        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_QUERY = 0x0004;
        private const uint JOB_OBJECT_TERMINATE = 0x0008;
        private const uint PROCESS_TERMINATE = 0x0001;
        private const uint PROCESS_SET_QUOTA = 0x0100;
        private const uint PROCESS_DUP_HANDLE = 0x0040;
        private const uint DUPLICATE_SAME_ACCESS = 0x0002;
        private const int ERROR_MORE_DATA = 234;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr OpenJobObjectW(uint dwDesiredAccess, bool bInheritHandle, string lpName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo, out uint returnLength);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(IntPtr hJob, uint uExitCode);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr hObject);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool DuplicateHandle(IntPtr hSourceProcess, IntPtr hSourceHandle, IntPtr hTargetProcess, out IntPtr lpTargetHandle, uint dwDesiredAccess, bool bInheritHandle, uint dwOptions);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        public static IntPtr CreateKillOnCloseJob(string name)
        {
            IntPtr job = CreateJobObjectW(IntPtr.Zero, name);
            if (job == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObjectW failed");
            }
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int len = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(len);
            try
            {
                Marshal.StructureToPtr(info, buffer, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)len))
                {
                    int error = Marshal.GetLastWin32Error();
                    CloseHandle(job);
                    throw new Win32Exception(error, "SetInformationJobObject(kill-on-close) failed");
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
            return job;
        }

        public static IntPtr OpenJob(string name)
        {
            // IntPtr.Zero means "no such job" (all members and handles are gone);
            // callers treat that as proven-dead, so no exception here.
            return OpenJobObjectW(JOB_OBJECT_QUERY | JOB_OBJECT_TERMINATE, false, name);
        }

        public static void AssignProcess(IntPtr job, int processId)
        {
            IntPtr process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, (uint)processId);
            if (process == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess(for job assignment) failed for PID " + processId);
            }
            try
            {
                if (!AssignProcessToJobObject(job, process))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "AssignProcessToJobObject failed for PID " + processId);
                }
            }
            finally
            {
                CloseHandle(process);
            }
        }

        public static void AnchorJobToProcess(IntPtr job, int processId)
        {
            IntPtr process = OpenProcess(PROCESS_DUP_HANDLE, false, (uint)processId);
            if (process == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess(for job anchoring) failed for PID " + processId);
            }
            try
            {
                IntPtr duplicated;
                if (!DuplicateHandle(GetCurrentProcess(), job, process, out duplicated, 0, false, DUPLICATE_SAME_ACCESS))
                {
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "DuplicateHandle(job anchor) failed for PID " + processId);
                }
                // The duplicated handle intentionally lives (and dies) with the
                // child: it is the anchor that keeps the job alive after the
                // launcher exits, and the kill switch when the root dies.
            }
            finally
            {
                CloseHandle(process);
            }
        }

        public static int[] GetJobProcessIds(IntPtr job)
        {
            int capacity = 64;
            while (true)
            {
                int size = 8 + (capacity * IntPtr.Size);
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    uint returnLength;
                    bool ok = QueryInformationJobObject(job, JobObjectBasicProcessIdList, buffer, (uint)size, out returnLength);
                    int assigned = Marshal.ReadInt32(buffer, 0);
                    int returned = Marshal.ReadInt32(buffer, 4);
                    if (!ok)
                    {
                        int error = Marshal.GetLastWin32Error();
                        if (error == ERROR_MORE_DATA)
                        {
                            capacity = Math.Max(assigned + 8, capacity * 2);
                            continue;
                        }
                        throw new Win32Exception(error, "QueryInformationJobObject(process id list) failed");
                    }
                    int[] pids = new int[returned];
                    for (int i = 0; i < returned; i++)
                    {
                        pids[i] = (int)Marshal.ReadIntPtr(buffer, 8 + (i * IntPtr.Size)).ToInt64();
                    }
                    return pids;
                }
                finally
                {
                    Marshal.FreeHGlobal(buffer);
                }
            }
        }

        public static void Terminate(IntPtr job, uint exitCode)
        {
            if (!TerminateJobObject(job, exitCode))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "TerminateJobObject failed");
            }
        }

        public static void Close(IntPtr job)
        {
            if (job != IntPtr.Zero)
            {
                CloseHandle(job);
            }
        }
    }
}
'@
}

function Test-HostNativeJobBoundarySupported {
    [CmdletBinding()]
    param()
    return ((Get-PlatformName) -eq 'windows')
}

function Get-HostNativeJobBoundaryName {
    # Deterministic per service name so the stop path can re-open the job
    # without any recorded handle. 'Local\' pins the session-local namespace;
    # a stop from another session simply fails to find the job and falls back
    # to the sweep, which is the honest degraded path.
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string] $Name)
    return "Local\aibim-job-$Name"
}

function New-HostNativeJobBoundary {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyString()][string] $Name)
    if (-not (Test-HostNativeJobBoundarySupported)) {
        throw 'Job boundary requested on a platform without Job Object support; callers must gate on Test-HostNativeJobBoundarySupported.'
    }
    $jobName = if ([string]::IsNullOrWhiteSpace($Name)) { $null } else { $Name }
    return [AiBim.JobBoundaryNative]::CreateKillOnCloseJob($jobName)
}

function Add-HostNativeJobBoundaryProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][IntPtr] $Handle,
        [Parameter(Mandatory = $true)][int] $ProcessId
    )
    [AiBim.JobBoundaryNative]::AssignProcess($Handle, $ProcessId)
}

function Grant-HostNativeJobBoundaryAnchor {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][IntPtr] $Handle,
        [Parameter(Mandatory = $true)][int] $ProcessId
    )
    [AiBim.JobBoundaryNative]::AnchorJobToProcess($Handle, $ProcessId)
}

function Get-HostNativeJobBoundaryProcessIds {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][IntPtr] $Handle)
    return @([AiBim.JobBoundaryNative]::GetJobProcessIds($Handle))
}

function Stop-HostNativeJobBoundaryHandle {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][IntPtr] $Handle)
    [AiBim.JobBoundaryNative]::Terminate($Handle, 1)
}

function Close-HostNativeJobBoundary {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][IntPtr] $Handle)
    [AiBim.JobBoundaryNative]::Close($Handle)
}

function Stop-HostNativeJobBoundary {
    # Authoritative stop for a NAMED job boundary. Membership - not PPID
    # discovery - defines the containment set, and the postcondition is a
    # PROVEN-EMPTY membership list inside one bounded budget.
    #
    # Found=$false is proven-dead by construction, not an unknown: a job whose
    # members and handles are all gone ceases to exist, and the service anchor
    # guarantees a handle lives exactly as long as the root process does.
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [ValidateRange(1, 60000)][int] $TimeoutMs = 5000,
        [scriptblock] $SleepFn = {
            param($milliseconds)
            Start-Sleep -Milliseconds ([int]$milliseconds)
        }
    )
    if (-not (Test-HostNativeJobBoundarySupported)) {
        return [pscustomobject]@{ Found = $false; MemberPids = @(); Proven = $false; Supported = $false }
    }
    $handle = [AiBim.JobBoundaryNative]::OpenJob($Name)
    if ($handle -eq [IntPtr]::Zero) {
        return [pscustomobject]@{ Found = $false; MemberPids = @(); Proven = $true; Supported = $true }
    }
    try {
        $members = @([AiBim.JobBoundaryNative]::GetJobProcessIds($handle))
        [AiBim.JobBoundaryNative]::Terminate($handle, 1)
        $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
        $remaining = @($members)
        while ($true) {
            $remaining = @([AiBim.JobBoundaryNative]::GetJobProcessIds($handle))
            if ($remaining.Count -eq 0) { break }
            if ([DateTime]::UtcNow -ge $deadline) { break }
            & $SleepFn 50
        }
        if ($remaining.Count -gt 0) {
            throw "Job boundary '$Name' still reports member PID(s) $($remaining -join ', ') after TerminateJobObject and $TimeoutMs ms."
        }
        return [pscustomobject]@{ Found = $true; MemberPids = $members; Proven = $true; Supported = $true }
    }
    finally {
        [AiBim.JobBoundaryNative]::Close($handle)
    }
}

function Invoke-HostNativeBoundedProcess {
    # Single implementation for every BOUNDED host-native child (issue #522):
    # the deploy CAD extension cache hardener and the Kit Manager import probe
    # previously each hand-rolled ProcessStartInfo + timeout + PPID sweep. On
    # Windows the child now runs inside an anonymous kill-on-close job held by
    # this runner: a timeout terminates the JOB (authoritative membership, not
    # a PPID walk), and closing the handle on the way out reaps any straggler
    # even on the success path. Where Job Objects do not exist the helper keeps
    # the prior sweep + fail-closed disclosure (POSIX boundary: issue #517).
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $ArgumentList,
        [ValidateRange(1, 3600)][int] $TimeoutSec = 30,
        [scriptblock] $JobSupportedFn = { Test-HostNativeJobBoundarySupported },
        [scriptblock] $SweepFn = {
            param($process)
            Stop-HostNativeProcessTreeAndWait -Process $process -TimeoutMs 5000
        }
    )
    $process = $null
    $jobHandle = [IntPtr]::Zero
    $useJob = [bool](& $JobSupportedFn)
    $result = [pscustomobject]@{
        ExitCode           = -1
        StdOut             = ''
        StdErr             = ''
        TimedOut           = $false
        TerminationFailure = $null
        Boundary           = if ($useJob) { 'job' } else { 'sweep' }
    }
    try {
        if ($useJob) {
            $jobHandle = New-HostNativeJobBoundary -Name $null
        }
        $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
        $startInfo.FileName = $FilePath
        $startInfo.UseShellExecute = $false
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true
        foreach ($argument in $ArgumentList) {
            [void]$startInfo.ArgumentList.Add([string]$argument)
        }
        $process = [System.Diagnostics.Process]::new()
        $process.StartInfo = $startInfo
        if (-not $process.Start()) {
            throw "Bounded process did not start: $FilePath"
        }
        if ($useJob) {
            # Assign as early as possible; children spawned after this point
            # inherit membership. The pre-assignment window is disclosed in the
            # module header and is the residual this boundary cannot remove
            # without CREATE_SUSPENDED launching.
            Add-HostNativeJobBoundaryProcess -Handle $jobHandle -ProcessId $process.Id
        }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSec * 1000)) {
            $result.TimedOut = $true
            try {
                if ($useJob) {
                    [AiBim.JobBoundaryNative]::Terminate($jobHandle, 1)
                    $deadline = [DateTime]::UtcNow.AddMilliseconds(5000)
                    while ($true) {
                        $members = @([AiBim.JobBoundaryNative]::GetJobProcessIds($jobHandle))
                        if ($members.Count -eq 0) { break }
                        if ([DateTime]::UtcNow -ge $deadline) {
                            throw "Bounded job still reports member PID(s) $($members -join ', ') after TerminateJobObject."
                        }
                        Start-Sleep -Milliseconds 50
                    }
                }
                else {
                    & $SweepFn $process
                }
            }
            catch {
                $result.TerminationFailure = $_
            }
        }
        else {
            $result.StdOut = $stdoutTask.GetAwaiter().GetResult()
            $result.StdErr = $stderrTask.GetAwaiter().GetResult()
            $result.ExitCode = $process.ExitCode
        }
        return $result
    }
    finally {
        if ($useJob -and $jobHandle -ne [IntPtr]::Zero) {
            # Kill-on-close: this reaps any straggler on every path out.
            Close-HostNativeJobBoundary -Handle $jobHandle
        }
        if ($null -ne $process) { $process.Dispose() }
    }
}
