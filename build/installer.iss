; AssetDock 安装器(Inno Setup 6,modern 风格 + 壁纸)
#define AppName "AssetDock"
#define AppVersion "1.1.0"
#define AppExe "AssetDock.exe"

[Setup]
AppId={{4E2B7A1D-9C3F-4D8B-B2A6-7F5C1E9D3A42}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=LingYingNX
AppPublisherURL=https://github.com/LingYingNX/AssetDock
VersionInfoVersion=1.1.0.0
VersionInfoProductName={#AppName}
VersionInfoDescription=AssetDock 素材管理器 安装程序
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
; 覆盖安装时 Inno 默认(auto)会跳过目录页,这里强制每次都显示
DisableDirPage=no
DisableProgramGroupPage=yes
DisableWelcomePage=no
PrivilegesRequired=lowest
OutputDir=..\artifacts\dist\inno
OutputBaseFilename={#AppName}-{#AppVersion}-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#AppExe}
WizardStyle=modern
WizardImageFile=wizard.png
WizardImageStretch=yes
WizardSmallImageFile=icon-96.png
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "zhcn"; MessagesFile: "ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\artifacts\dist\win-unpacked\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: dirifempty; Name: "{app}"

[Code]
{ 用户选 D:\管理器 时自动补成 D:\管理器\AssetDock,避免文件散落在所选目录根部 }
function NextButtonClick(CurPageID: Integer): Boolean;
var
  Dir: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then
  begin
    Dir := RemoveBackslashUnlessRoot(WizardForm.DirEdit.Text);
    if CompareText(ExtractFileName(Dir), '{#AppName}') <> 0 then
      WizardForm.DirEdit.Text := AddBackslash(Dir) + '{#AppName}';
  end;
end;

{ 卸载阶段可能还有子进程没退干净,给两次重试再放弃 }
procedure DeleteTreeWithRetry(const Dir: String);
var
  Attempt: Integer;
begin
  for Attempt := 1 to 3 do
  begin
    if not DirExists(Dir) then Exit;
    DelTree(Dir, True, True, True);
    if not DirExists(Dir) then Exit;
    Sleep(400);
  end;
end;

{ 应用还开着时数据库/缓存文件会被占用:先尝试关掉,删不掉就挂到下次登录由 cmd 再删 }
procedure DeleteUserDataTree(const Dir: String; const RunOnceName: String);
begin
  DeleteTreeWithRetry(Dir);
  if DirExists(Dir) then
    RegWriteStringValue(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows\CurrentVersion\RunOnce', RunOnceName,
      'cmd.exe /c rd /s /q "' + RemoveBackslashUnlessRoot(Dir) + '"');
end;

{ 上次卸载没删掉时挂了 RunOnce;重新安装必须取消,否则下次登录会把新装的数据也删了 }
procedure ClearPendingUninstallCleanup;
begin
  RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'AssetDockUninstallCleanup1');
  RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'AssetDockUninstallCleanup2');
  RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'MediaHubUninstallCleanup1');
  RegDeleteValue(HKEY_CURRENT_USER, 'Software\Microsoft\Windows\CurrentVersion\RunOnce', 'MediaHubUninstallCleanup2');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    ClearPendingUninstallCleanup;
end;

{ 测试与资源补丁会按 <app>-assetpatch-* 建临时目录,卸载时一并清掉 }
procedure DeleteAssetPatchTempDirs(const Prefix: String);
var
  FindRec: TFindRec;
  BaseDir: String;
begin
  BaseDir := GetEnv('TEMP');
  if BaseDir = '' then Exit;
  BaseDir := AddBackslash(BaseDir);
  if FindFirst(BaseDir + Prefix + '-assetpatch-*', FindRec) then
  begin
    try
      repeat
        { 16 = FILE_ATTRIBUTE_DIRECTORY;Inno 的 Pascal 脚本没有导出 faDirectory 常量 }
        if ((FindRec.Attributes and 16) <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') then
          DelTree(BaseDir + FindRec.Name, True, True, True);
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

{ 卸载时先问是否清数据;注册表杂项不依赖回答,直接删 }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ExePath: String;
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\AssetDock');
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\assetdock');
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\MediaHub');
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\mediahub');
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\Classes\assetdock');
    RegDeleteKeyIncludingSubkeys(HKEY_CURRENT_USER, 'Software\Classes\mediahub');

    { Windows 自己写的两条缓存:搜索跳转列表与应用名缓存,不删就会在卸载工具里露出来 }
    ExePath := ExpandConstant('{app}\{#AppExe}');
    RegDeleteValue(HKEY_CURRENT_USER,
      'Software\Microsoft\Windows\CurrentVersion\Search\JumplistData', ExePath);
    RegDeleteValue(HKEY_CURRENT_USER,
      'Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache',
      ExePath + '.FriendlyAppName');
    RegDeleteValue(HKEY_CURRENT_USER,
      'Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache',
      ExePath + '.ApplicationCompany');

    { SuppressibleMsgBox 才能让静默卸载自动跳过询问;普通 MsgBox 会把 /VERYSILENT 卡住 }
    if SuppressibleMsgBox('是否同时删除 AssetDock 的配置、素材索引、缩略图与更新缓存？' + #13#10 + #13#10 +
      '只删除本机数据，素材库里的原始文件不会删除。', mbConfirmation, MB_YESNO or MB_DEFBUTTON1, IDYES) = IDYES then
    begin
      Exec('taskkill.exe', '/F /IM AssetDock.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Exec('taskkill.exe', '/F /IM MediaHub.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(500);
      DeleteUserDataTree(ExpandConstant('{userappdata}\AssetDock'), 'AssetDockUninstallCleanup1');
      DeleteUserDataTree(ExpandConstant('{userappdata}\assetdock'), 'AssetDockUninstallCleanup2');
      DeleteUserDataTree(ExpandConstant('{userappdata}\MediaHub'), 'MediaHubUninstallCleanup1');
      DeleteUserDataTree(ExpandConstant('{userappdata}\mediahub'), 'MediaHubUninstallCleanup2');
      DeleteTreeWithRetry(ExpandConstant('{localappdata}\AssetDock'));
      DeleteTreeWithRetry(ExpandConstant('{localappdata}\assetdock'));
      DeleteTreeWithRetry(ExpandConstant('{localappdata}\assetdock-updater'));
      DeleteTreeWithRetry(ExpandConstant('{localappdata}\MediaHub'));
      DeleteTreeWithRetry(ExpandConstant('{localappdata}\mediahub'));
      DeleteTreeWithRetry(ExpandConstant('{localappdata}\mediahub-updater'));
      DeleteAssetPatchTempDirs('AssetDock');
      DeleteAssetPatchTempDirs('mediahub');
    end;
  end;
end;
