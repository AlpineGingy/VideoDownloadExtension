#ifndef PackageRoot
  #error PackageRoot must point to the published companion package.
#endif
#ifndef Runtime
  #error Runtime must be win-x64 or win-arm64.
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef OutputDirectory
  #define OutputDirectory "."
#endif

[Setup]
AppId={{7BFB50CA-1A02-49BA-A211-D0C0358E3FD4}
AppName=Media Finder Companion
AppVersion={#AppVersion}
AppPublisher=Media Finder
DefaultDirName={localappdata}\MediaFinder\Installer
DisableProgramGroupPage=yes
OutputDir={#OutputDirectory}
OutputBaseFilename=media-finder-companion-{#Runtime}-setup
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=lowest
#if Runtime == "win-arm64"
ArchitecturesAllowed=arm64
#else
ArchitecturesAllowed=x64compatible
#endif
WizardStyle=modern
UninstallDisplayName=Media Finder Companion

[Files]
Source: "{#PackageRoot}\media-finder-companion.exe"; DestDir: "{tmp}\media-finder-package"; Flags: deleteafterinstall ignoreversion
Source: "{#PackageRoot}\install-windows.ps1"; DestDir: "{tmp}\media-finder-package"; Flags: deleteafterinstall ignoreversion
Source: "{#PackageRoot}\uninstall-windows.ps1"; DestDir: "{app}"; Flags: ignoreversion

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall-windows.ps1"""; Flags: waituntilterminated runhidden; RunOnceId: "RemoveMediaFinderCompanion"

[Code]
// Runs the existing per-user bootstrap and makes a dependency failure fail Setup visibly.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  PowerShellPath: String;
  InstallerPath: String;
begin
  if CurStep <> ssPostInstall then
    exit;

  WizardForm.StatusLabel.Caption := 'Installing Media Finder, yt-dlp, Deno, and FFmpeg...';
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  InstallerPath := ExpandConstant('{tmp}\media-finder-package\install-windows.ps1');
  if not Exec(
    PowerShellPath,
    '-NoProfile -ExecutionPolicy Bypass -File "' + InstallerPath + '"',
    '',
    SW_SHOW,
    ewWaitUntilTerminated,
    ResultCode
  ) or (ResultCode <> 0) then
    RaiseException('Media Finder setup could not install its required tools. Review the PowerShell error and run Setup again.');
end;
