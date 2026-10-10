using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

public static class HonoWardenPreauthNative {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Credential {
    public uint Flags,Type; public string Target,Comment; public long Written; public uint Size; public IntPtr Blob;
    public uint Persist,AttributeCount; public IntPtr Attributes; public string Alias,User;
  }
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CredWriteW(ref Credential value,uint flags);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CredReadW(string target,uint type,uint flags,out IntPtr value);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CredDeleteW(string target,uint type,uint flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr value);
  static void Target(string target) {
    if(!System.Text.RegularExpressions.Regex.IsMatch(target,"^HonoWarden-HostedPreauth-[a-f0-9-]{36}$")) throw new InvalidOperationException("marker_target_invalid");
  }
  public static bool MarkerExists(string target) {
    Target(target); IntPtr value;
    if(CredReadW(target,1,0,out value)) { CredFree(value); return true; }
    int error=Marshal.GetLastWin32Error(); if(error==1168) return false; throw new Win32Exception(error);
  }
  public static bool MarkerProbe(string target) {
    Target(target); if(MarkerExists(target)) throw new InvalidOperationException("marker_exists");
    byte[] bytes=Encoding.UTF8.GetBytes("HonoWarden public pre-auth marker");
    IntPtr blob=Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes,0,blob,bytes.Length);
      var value=new Credential {Type=1,Target=target,Size=(uint)bytes.Length,Blob=blob,Persist=1,User="public-marker"};
      if(!CredWriteW(ref value,0)) throw new Win32Exception(Marshal.GetLastWin32Error());
      IntPtr saved; if(!CredReadW(target,1,0,out saved)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        var result=(Credential)Marshal.PtrToStructure(saved,typeof(Credential));
        if(result.Size!=bytes.Length) return false;
        byte[] actual=new byte[bytes.Length]; Marshal.Copy(result.Blob,actual,0,actual.Length);
        bool matches=Convert.ToBase64String(bytes)==Convert.ToBase64String(actual); Array.Clear(actual,0,actual.Length); return matches;
      } finally { CredFree(saved); }
    } finally { Array.Clear(bytes,0,bytes.Length); Marshal.FreeHGlobal(blob); }
  }
  public static bool RemoveMarker(string target) {
    Target(target);
    if(!CredDeleteW(target,1,0) && Marshal.GetLastWin32Error()!=1168) throw new Win32Exception(Marshal.GetLastWin32Error());
    return !MarkerExists(target);
  }
  public static bool DpapiProbe() {
    byte[] bytes=Encoding.UTF8.GetBytes("HonoWarden public DPAPI marker"), wrapped=null, plain=null;
    try {
      wrapped=ProtectedData.Protect(bytes,null,DataProtectionScope.CurrentUser);
      plain=ProtectedData.Unprotect(wrapped,null,DataProtectionScope.CurrentUser);
      return Convert.ToBase64String(bytes)==Convert.ToBase64String(plain);
    } finally { Array.Clear(bytes,0,bytes.Length); if(wrapped!=null) Array.Clear(wrapped,0,wrapped.Length); if(plain!=null) Array.Clear(plain,0,plain.Length); }
  }
}
