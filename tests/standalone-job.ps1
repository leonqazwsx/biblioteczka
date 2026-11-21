param([string]$AppRoot,[int]$Port,[switch]$Nested)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($AppRoot)
if(-not $taskRoot.StartsWith([IO.Path]::GetFullPath($env:TEMP)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $taskRoot) -notlike 'Bookshelf standalone*'){throw 'Fixture root required.'}
Add-Type -TypeDefinition @'
using System;using System.Text;using System.Runtime.InteropServices;
public static class OwnedBookshelfJob {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct SI {public int cb;public string reserved;public string desktop;public string title;public int x,y,xSize,ySize,xChars,yChars,fill,flags;public short show,reserved2;public IntPtr reservedPtr,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] public struct PI {public IntPtr process,thread;public int pid,tid;}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr p,uint l);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string a,StringBuilder c,IntPtr pa,IntPtr ta,bool i,uint f,IntPtr e,string d,ref SI si,out PI pi);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
 [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr p,uint c);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr j,int c,IntPtr p,uint l,IntPtr r);
 public static IntPtr Start(string exe,string command,string root,bool nested){
  IntPtr job=CreateJobObject(IntPtr.Zero,null),inner=IntPtr.Zero,data=Marshal.AllocHGlobal(144);PI pi=new PI();
  try {Marshal.Copy(new byte[144],0,data,144);Marshal.WriteInt32(data,16,0x2800);if(job==IntPtr.Zero||!SetInformationJobObject(job,9,data,144))throw new Exception("owned job setup");
   SI si=new SI();si.cb=Marshal.SizeOf(si);si.flags=1;si.show=0;
   if(!CreateProcess(exe,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,false,0x01000014,IntPtr.Zero,root,ref si,out pi))throw new Exception("owned child create "+Marshal.GetLastWin32Error());
   if(!AssignProcessToJobObject(job,pi.process))throw new Exception("owned child assignment");
   if(nested){inner=CreateJobObject(IntPtr.Zero,null);if(inner==IntPtr.Zero||!AssignProcessToJobObject(inner,pi.process))throw new Exception("owned inner assignment");}
   ResumeThread(pi.thread);return job;
  } catch {if(pi.process!=IntPtr.Zero)TerminateProcess(pi.process,1);if(job!=IntPtr.Zero)CloseHandle(job);throw;}
  finally {Marshal.FreeHGlobal(data);if(inner!=IntPtr.Zero)CloseHandle(inner);if(pi.thread!=IntPtr.Zero)CloseHandle(pi.thread);if(pi.process!=IntPtr.Zero)CloseHandle(pi.process);}
 }
}
'@
$taskExe=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$taskCommand='"'+$taskExe+'" -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $taskRoot 'scripts/start.ps1')+'" -AppRoot "'+$taskRoot+'" -Port '+$Port+' -NoBrowser'
$taskJob=[OwnedBookshelfJob]::Start($taskExe,$taskCommand,$taskRoot,[bool]$Nested)
try{
 $taskHealth=$null;$taskTray=$null;$taskOrigin='http://127.0.0.1:'+$Port
 for($taskN=0;$taskN -lt 120;$taskN++){
  try{$taskHealth=Invoke-RestMethod ($taskOrigin+'/api/health') -TimeoutSec 1;$taskTray=Get-Content -LiteralPath (Join-Path $taskRoot 'data/tray-state.json') -Raw -ErrorAction Stop|ConvertFrom-Json;if($taskTray.serverPid -eq $taskHealth.pid){break}}catch{}
  Start-Sleep -Milliseconds 250
 }
 if(-not $taskHealth -or -not $taskTray -or $taskTray.serverPid -ne $taskHealth.pid){throw 'Owned fixture did not become ready.'}
 $taskBuffer=[Runtime.InteropServices.Marshal]::AllocHGlobal(65536)
 try{
  if(-not [OwnedBookshelfJob]::QueryInformationJobObject($taskJob,3,$taskBuffer,65536,[IntPtr]::Zero)){throw 'Cannot inspect owned job.'}
  $taskCount=[Runtime.InteropServices.Marshal]::ReadInt32($taskBuffer,4)
  for($taskI=0;$taskI -lt $taskCount;$taskI++){$taskMember=[Runtime.InteropServices.Marshal]::ReadInt64($taskBuffer,8+$taskI*8);if($taskMember -in @($taskHealth.pid,$taskTray.pid)){throw 'Runtime inherited the kill-on-close launcher job.'}}
 }finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($taskBuffer)}
 [void][OwnedBookshelfJob]::CloseHandle($taskJob);$taskJob=[IntPtr]::Zero
 $taskAfter=Invoke-RestMethod ($taskOrigin+'/api/health') -TimeoutSec 2
 if($taskAfter.sessionId -ne $taskHealth.sessionId -or -not (Get-Process -Id $taskTray.pid -ErrorAction SilentlyContinue)){throw 'Runtime did not survive owned Job closure.'}
 Write-Output 'STANDALONE_JOB_OK'
}finally{if($taskJob -ne [IntPtr]::Zero){[void][OwnedBookshelfJob]::CloseHandle($taskJob)}}
