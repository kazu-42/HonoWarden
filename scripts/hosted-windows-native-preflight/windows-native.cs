using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class HonoWardenWindowsNative {
  [StructLayout(LayoutKind.Sequential)] public struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
    public uint ActiveProcesses; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] public struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Startup {
    public uint Size; public string Reserved, Desktop, Title; public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
    public ushort ShowWindow, ReservedSize; public IntPtr ReservedBytes, StandardInput, StandardOutput, StandardError;
  }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr AttributeList; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr security, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, IntPtr data, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, uint length, out uint returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string executable, StringBuilder command,
    IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref UIntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("user32.dll")] static extern IntPtr GetMenu(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int position);
  [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu, int position);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder text, int max, uint flags);
  [DllImport("user32.dll")] static extern uint GetMenuState(IntPtr menu, uint item, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message,
    UIntPtr word, IntPtr parameter, uint flags, uint timeout, out UIntPtr result);

  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) {
    var output = new StringBuilder("\""); int slashes = 0;
    foreach(char c in value) { if(c == '\\') { slashes++; continue; }
      if(c == '"') output.Append('\\', slashes * 2 + 1); else output.Append('\\', slashes);
      slashes = 0; output.Append(c);
    }
    output.Append('\\', slashes * 2); return output.Append('"').ToString();
  }
  public static SafeFileHandle OpenNullOutput() {
    // .NET Framework path-based FileStream rejects character devices. Open only
    // the fixed NUL device, never a caller-selected file or inherited output.
    SafeFileHandle handle = CreateFileW("NUL", 0x40000000, 0x3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if(handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
    return handle;
  }
  public static IntPtr CreateOwnedJob(string name) {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, name); int error = Marshal.GetLastWin32Error();
    if(job == IntPtr.Zero || error == 183) { if(job != IntPtr.Zero) CloseHandle(job); throw new InvalidOperationException("owned_job_creation_failed"); }
    var limits = new ExtendedLimits();
    // Kill-on-close + bounded process count; neither breakaway flag is granted.
    limits.Basic.Flags = 0x2000 | 0x8; limits.Basic.ActiveProcesses = 128;
    int length = Marshal.SizeOf(typeof(ExtendedLimits)); IntPtr buffer = Marshal.AllocHGlobal(length);
    try { Marshal.StructureToPtr(limits, buffer, false); Check(SetInformationJobObject(job, 9, buffer, (uint)length)); return job; }
    catch { CloseHandle(job); throw; } finally { Marshal.FreeHGlobal(buffer); }
  }
  public static ProcessInfo StartOwnedNode(IntPtr job, string executable, string script, string directory,
    string environmentBlock, IntPtr stdin, IntPtr stdout) {
    var startup = new StartupEx(); startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Startup.Flags = 0x100;
    startup.Startup.StandardInput = stdin; startup.Startup.StandardOutput = stdout; startup.Startup.StandardError = stdout;
    UIntPtr attributeSize = UIntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
    startup.AttributeList = Marshal.AllocHGlobal(checked((int)attributeSize.ToUInt64()));
    IntPtr handles = Marshal.AllocHGlobal(IntPtr.Size * 2); bool initialized = false;
    ProcessInfo info; IntPtr environment = Marshal.StringToHGlobalUni(environmentBlock);
    try {
      Check(InitializeProcThreadAttributeList(startup.AttributeList, 1, 0, ref attributeSize)); initialized = true;
      Marshal.WriteIntPtr(handles, 0, stdin); Marshal.WriteIntPtr(handles, IntPtr.Size, stdout);
      // PROC_THREAD_ATTRIBUTE_HANDLE_LIST admits only the private input pipe and NUL output.
      Check(UpdateProcThreadAttribute(startup.AttributeList, 0, (UIntPtr)0x20002, handles, (UIntPtr)(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero));
      // CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT: assign before any Node/application instruction executes.
      Check(CreateProcessW(executable, new StringBuilder(Quote(executable)+" "+Quote(script)), IntPtr.Zero, IntPtr.Zero, true,
        0x4 | 0x400 | 0x80000, environment, directory, ref startup, out info));
      try { Check(AssignProcessToJobObject(job, info.Process)); Check(ResumeThread(info.Thread) != 0xffffffff); }
      catch { TerminateProcess(info.Process, 73); CloseHandle(info.Thread); CloseHandle(info.Process); throw; }
      return info;
    } finally { if(initialized) DeleteProcThreadAttributeList(startup.AttributeList);
      Marshal.FreeHGlobal(startup.AttributeList); Marshal.FreeHGlobal(handles); Marshal.FreeHGlobal(environment); }
  }
  public static uint[] JobPids(string name) {
    IntPtr job = OpenJobObjectW(0x4, false, name); Check(job != IntPtr.Zero);
    const int capacity = 128; int length = 8 + IntPtr.Size * capacity; IntPtr buffer = Marshal.AllocHGlobal(length);
    try { uint returned; Check(QueryInformationJobObject(job, 3, buffer, (uint)length, out returned));
      int assigned = Marshal.ReadInt32(buffer, 0), listed = Marshal.ReadInt32(buffer, 4);
      if(assigned != listed || listed < 0 || listed > capacity) throw new InvalidOperationException("job_pid_bound");
      var values = new uint[listed]; for(int i=0;i<listed;i++) values[i] = checked((uint)Marshal.ReadIntPtr(buffer, 8+i*IntPtr.Size).ToInt64());
      return values;
    } finally { Marshal.FreeHGlobal(buffer); CloseHandle(job); }
  }
  static void FindMenu(IntPtr menu, string expected, List<uint> found, int depth, ref int inspected) {
    if(depth > 5) throw new InvalidOperationException("native_menu_bound");
    int length = GetMenuItemCount(menu); if(length < 0 || length > 100) throw new InvalidOperationException("native_menu_bound");
    for(int i=0;i<length;i++) { if(++inspected > 500) throw new InvalidOperationException("native_menu_bound");
      var text = new StringBuilder(512); GetMenuStringW(menu, (uint)i, text, 512, 0x400);
      IntPtr child = GetSubMenu(menu, i); if(child != IntPtr.Zero) FindMenu(child, expected, found, depth+1, ref inspected);
      else if(text.ToString().Split('\t')[0].Replace("&", "").Trim() == expected) {
        uint state = GetMenuState(menu, (uint)i, 0x400), id = GetMenuItemID(menu, i);
        if((state & 0x3) != 0 || id == 0xffffffff || id > 65535) throw new InvalidOperationException("native_menu_disabled");
        found.Add(id);
      }
    }
  }
  public static void InvokeOwnedMenu(IntPtr window, uint expectedPid, string expected) {
    uint pid; GetWindowThreadProcessId(window, out pid); if(pid != expectedPid) throw new InvalidOperationException("native_window_identity");
    IntPtr menu = GetMenu(window); if(menu == IntPtr.Zero) throw new InvalidOperationException("native_menu_absent");
    var found = new List<uint>(); int inspected=0; FindMenu(menu, expected, found, 0, ref inspected);
    if(found.Count != 1) throw new InvalidOperationException("native_menu_not_unique");
    UIntPtr result; Check(SendMessageTimeoutW(window, 0x111, (UIntPtr)found[0], IntPtr.Zero, 0x2, 2000, out result) != IntPtr.Zero);
  }
  public static bool VisibleOwnedWindow(IntPtr window,uint expectedPid) {
    uint actual; return window!=IntPtr.Zero && GetWindowThreadProcessId(window,out actual)!=0 && actual==expectedPid && IsWindowVisible(window);
  }
}
