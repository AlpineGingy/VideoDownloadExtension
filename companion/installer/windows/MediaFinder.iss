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
// Runs the per-user bootstrap, optionally closing only an idle companion after approval.
function RunCompanionInstaller(StopRunningCompanion: Boolean; var ResultCode: Integer): Boolean;
var
  PowerShellPath: String;
  InstallerPath: String;
  Arguments: String;
begin
  PowerShellPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  InstallerPath := ExpandConstant('{tmp}\media-finder-package\install-windows.ps1');
  Arguments := '-NoProfile -ExecutionPolicy Bypass -File "' + InstallerPath + '"';
  if StopRunningCompanion then
    Arguments := Arguments + ' -StopRunningCompanion';
  Result := Exec(PowerShellPath, Arguments, '', SW_SHOW, ewWaitUntilTerminated, ResultCode);
end;

// Gives the user a safe choice when an idle companion must be replaced during an update.
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    exit;

  WizardForm.StatusLabel.Caption := 'Installing Media Finder, yt-dlp, Deno, and FFmpeg...';
  if not RunCompanionInstaller(False, ResultCode) then
    RaiseException('Media Finder setup could not start PowerShell. Run Setup again.');

  if ResultCode = 20 then begin
    if MsgBox(
      'Media Finder is currently running, but no download is active. Close its idle companion and continue the update?',
      mbConfirmation,
      MB_YESNO
    ) = IDYES then begin
      if not RunCompanionInstaller(True, ResultCode) then
        RaiseException('Media Finder setup could not restart PowerShell. Run Setup again.');
    end
    else
      RaiseException('Setup was stopped so the running Media Finder companion is not interrupted.');
  end;

  if ResultCode = 21 then
    RaiseException('An active yt-dlp download is running. Let it finish or cancel it before updating Media Finder.');
  if ResultCode <> 0 then
    RaiseException('Media Finder setup failed. See %LOCALAPPDATA%\\MediaFinder\\Logs\\install-error.log for the exact PowerShell error.');
end;
