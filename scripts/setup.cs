using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

internal static class Setup {
 [STAThread]
 private static int Main(string[] args) {
  bool quiet=false;string target=null;int port=47831;
  foreach(string arg in args) {
   if(arg=="/quiet")quiet=true;
   else if(arg.StartsWith("/target:",StringComparison.OrdinalIgnoreCase))target=arg.Substring(8);
   else if(arg.StartsWith("/port:",StringComparison.OrdinalIgnoreCase)) { if(!Int32.TryParse(arg.Substring(6),out port)||port<1||port>65535)return 1; }
   else return 1;
  }
  Application.EnableVisualStyles();
  if(target==null) {
   if(quiet)return 1;
   string exeFolder=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
   string parent=Directory.GetParent(exeFolder).FullName;
   if(!File.Exists(Path.Combine(parent,"Biblioteczka","package.json")))parent=Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
   using(FolderBrowserDialog dialog=new FolderBrowserDialog()) {
    dialog.Description="Wybierz folder dla Biblioteczki. Aby zaktualizować, wybierz dotychczasowy folder.";dialog.SelectedPath=parent;
    if(dialog.ShowDialog()!=DialogResult.OK)return 0;
    target=Path.GetFileName(dialog.SelectedPath)=="Biblioteczka"?dialog.SelectedPath:Path.Combine(dialog.SelectedPath,"Biblioteczka");
   }
  }
  string temp=Path.Combine(Path.GetTempPath(),"Biblioteczka-setup-"+Guid.NewGuid().ToString("N"));
  string log=Path.Combine(temp,"install.log");int result=1;string error=null;string warning=null;
  Action install=delegate {
   try {
    if(!Path.IsPathRooted(target)||Path.GetFileName(Path.GetFullPath(target))!="Biblioteczka")throw new InvalidOperationException("Folder docelowy musi mieć nazwę Biblioteczka.");
    Directory.CreateDirectory(temp);
    using(Stream stream=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
    using(ZipArchive zip=new ZipArchive(stream,ZipArchiveMode.Read)) {
     string prefix=Path.GetFullPath(temp)+Path.DirectorySeparatorChar;
     foreach(ZipArchiveEntry entry in zip.Entries) {
      string file=Path.GetFullPath(Path.Combine(temp,entry.FullName));
      if(!file.StartsWith(prefix,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Nieprawidłowa ścieżka w instalatorze.");
      if(String.IsNullOrEmpty(entry.Name))Directory.CreateDirectory(file);
      else { Directory.CreateDirectory(Path.GetDirectoryName(file));using(Stream input=entry.Open())using(Stream output=File.Create(file))input.CopyTo(output); }
     }
    }
    string shell=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"System32","WindowsPowerShell","v1.0","powershell.exe");
    ProcessStartInfo start=new ProcessStartInfo(shell,"-NoProfile -ExecutionPolicy Bypass -File "+Quote(Path.Combine(temp,"scripts","install.ps1"))+" -Source "+Quote(temp)+" -Target "+Quote(target)+" -Port "+port+(quiet?" -Quiet":""));
    start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
    using(StreamWriter writer=new StreamWriter(log))using(Process child=new Process()) {
     child.StartInfo=start;object gate=new object();bool capture=true;writer.AutoFlush=true;
     child.OutputDataReceived+=delegate(object sender,DataReceivedEventArgs e){lock(gate){if(capture&&e.Data!=null){writer.WriteLine(e.Data);if(e.Data.StartsWith("BOOKSHELF_CLEANUP_WARNING: "))warning=e.Data.Substring(27);}}};
     child.ErrorDataReceived+=delegate(object sender,DataReceivedEventArgs e){lock(gate){if(capture&&e.Data!=null)writer.WriteLine(e.Data);}};
     child.Start();child.BeginOutputReadLine();child.BeginErrorReadLine();
     // Detached Node can retain inherited handles. Wait for this process, not pipe EOF.
     while(!child.WaitForExit(250)) { }
     result=child.ExitCode;lock(gate){capture=false;writer.Flush();}
     child.CancelOutputRead();child.CancelErrorRead();
    }
    string warningPath=Path.Combine(temp,"install-warning.txt");if(File.Exists(warningPath))warning=File.ReadAllText(warningPath);
    if(result!=0)throw new InvalidOperationException("Instalacja nie zakończyła się. Poprzednie dane zostały zachowane. Szczegóły: "+log);
    string prefixTemp=Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
    if(!Path.GetFullPath(temp).StartsWith(prefixTemp,StringComparison.OrdinalIgnoreCase)||!Path.GetFileName(temp).StartsWith("Biblioteczka-setup-",StringComparison.Ordinal))throw new InvalidOperationException("Nieprawidłowa ścieżka porządkowania.");
    try{Directory.Delete(temp,true);}catch(Exception e){warning="Biblioteczka działa. Pozostał folder instalatora: "+temp+". "+e.Message;}
    if(warning!=null)Console.WriteLine("BOOKSHELF_CLEANUP_WARNING: "+warning);
   }catch(Exception e){result=1;error=e.Message;Console.Error.WriteLine(error);}
  };
  if(quiet)install();
  else using(Form progress=new Form()) {
   progress.Text="Biblioteczka";progress.Width=430;progress.Height=150;progress.StartPosition=FormStartPosition.CenterScreen;progress.ControlBox=false;
   Label text=new Label();text.Text="Instalowanie Biblioteczki…\nKolekcja zostanie zachowana.";text.Left=20;text.Top=20;text.AutoSize=true;progress.Controls.Add(text);
   ProgressBar bar=new ProgressBar();bar.Left=20;bar.Top=70;bar.Width=370;bar.Style=ProgressBarStyle.Marquee;progress.Controls.Add(bar);
   progress.Shown+=delegate {ThreadPool.QueueUserWorkItem(delegate {install();progress.BeginInvoke(new Action(delegate {progress.Close();}));});};
   Application.Run(progress);
   MessageBox.Show(result==0?"Biblioteczka została zainstalowana w:\n"+target+(warning==null?"":"\n\nUwaga: "+warning):error,"Biblioteczka",MessageBoxButtons.OK,result==0?MessageBoxIcon.Information:MessageBoxIcon.Error);
  }
  return result;
 }
 private static string Quote(string text){return "\""+text.Replace("\"","\\\"")+"\"";}
}
