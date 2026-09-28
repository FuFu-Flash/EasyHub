!include nsDialogs.nsh
!include LogicLib.nsh
!include MUI2.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var DesktopShortcutState
Var EasyHubPathInput
Var EasyHubBrowseButton
Var EasyHubExplicitPath
Var EasyHubChosenPath
Var EasyHubPreviousPath

!macro EasyHubDefaultPath
  ; A fixed data drive is preferred for a first install. Do not pick a USB drive.
  StrCpy $R0 ""
  System::Call 'kernel32::GetDriveTypeW(w "D:\") i .r1'
  ${If} $R1 == 3
    StrCpy $R0 "D:\EasyHub"
  ${EndIf}
  ${If} $R0 == ""
    System::Call 'kernel32::GetDriveTypeW(w "E:\") i .r1'
    ${If} $R1 == 3
      StrCpy $R0 "E:\EasyHub"
    ${EndIf}
  ${EndIf}
  ${If} $R0 == ""
    System::Call 'kernel32::GetDriveTypeW(w "F:\") i .r1'
    ${If} $R1 == 3
      StrCpy $R0 "F:\EasyHub"
    ${EndIf}
  ${EndIf}
  ${If} $R0 == ""
    StrCpy $R0 "$LocalAppData\Programs\EasyHub"
  ${EndIf}
  StrCpy $INSTDIR $R0
!macroend

Function EasyHubChooseInstallPath
  ${If} $EasyHubChosenPath != ""
    StrCpy $INSTDIR $EasyHubChosenPath
    Return
  ${EndIf}
  ; electron-builder records the selected installation folder in this key.
  ; Reuse it for upgrades, including a folder whose name differs from EasyHub.
  ${If} $EasyHubExplicitPath != ""
    StrCpy $INSTDIR $EasyHubExplicitPath
    Return
  ${EndIf}
  ReadRegStr $R0 HKCU "Software\${APP_GUID}" InstallLocation
  ${If} $R0 == ""
    ReadRegStr $R0 HKLM "Software\${APP_GUID}" InstallLocation
  ${EndIf}
  ${If} $R0 != ""
    StrCpy $EasyHubPreviousPath $R0
    StrCpy $INSTDIR $R0
  ${Else}
    !insertmacro EasyHubDefaultPath
  ${EndIf}
FunctionEnd

!macro customInit
  ; Silent installs have no page callback. Preserve /D and older installs here.
  !insertmacro GetDParameter $EasyHubExplicitPath
  ${GetParameters} $R0
  ${GetOptions} $R0 "/NO_DESKTOP_SHORTCUT=" $R1
  ${If} $R1 == "1"
    StrCpy $DesktopShortcutState ${BST_UNCHECKED}
  ${EndIf}
  Call EasyHubChooseInstallPath
!macroend

!macro customPageAfterChangeDir
  Page custom EasyHubOptionsCreate EasyHubOptionsLeave
!macroend

Function EasyHubNormalizeInstallPath
  GetFullPathName $INSTDIR $INSTDIR
  ${If} $INSTDIR == $EasyHubPreviousPath
    Return
  ${EndIf}
  StrCpy $R0 $INSTDIR 8 -8
  ${If} $R0 != "\EasyHub"
    ${IfNot} ${FileExists} "$INSTDIR\EasyHub.exe"
      StrCpy $INSTDIR "$INSTDIR\EasyHub"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function EasyHubBrowseInstallPath
  nsDialogs::SelectFolderDialog "选择 EasyHub 的安装位置" "$INSTDIR"
  Pop $R0
  ${If} $R0 != "error"
    StrCpy $INSTDIR $R0
    Call EasyHubNormalizeInstallPath
    ${NSD_SetText} $EasyHubPathInput "$INSTDIR"
  ${EndIf}
FunctionEnd

Function EasyHubOptionsCreate
  Call EasyHubChooseInstallPath
  !insertmacro MUI_HEADER_TEXT "安装 EasyHub" "选择安装位置和桌面快捷方式"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  SetCtlColors $0 "" "F5F8FD"

  ${NSD_CreateLabel} 0 0 100% 18u "让创作继续，从这里开始。"
  Pop $0
  SetCtlColors $0 "193A68" "F5F8FD"
  ${NSD_CreateLabel} 0 31u 100% 15u "安装位置"
  Pop $0
  SetCtlColors $0 "193A68" "F5F8FD"
  ${NSD_CreateText} 0 51u 75% 21u "$INSTDIR"
  Pop $EasyHubPathInput
  ${NSD_CreateButton} 78% 51u 22% 21u "浏览..."
  Pop $EasyHubBrowseButton
  ${NSD_OnClick} $EasyHubBrowseButton EasyHubBrowseInstallPath

  ${NSD_CreateLabel} 0 79u 100% 27u "首次安装优先使用其他固定磁盘；再次安装会记住之前的位置。安装时自动创建文件夹。"
  Pop $0
  SetCtlColors $0 "5B718E" "F5F8FD"
  ${NSD_CreateCheckbox} 0 112u 100% 17u "创建桌面快捷方式"
  Pop $DesktopShortcutCheckbox
  ${NSD_Check} $DesktopShortcutCheckbox
  nsDialogs::Show
FunctionEnd

Function EasyHubOptionsLeave
  ${NSD_GetText} $EasyHubPathInput $INSTDIR
  ${If} $INSTDIR == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择安装位置。"
    Abort
  ${EndIf}
  Call EasyHubNormalizeInstallPath
  StrCpy $EasyHubChosenPath $INSTDIR
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutState
FunctionEnd

!macro customInstall
  ${If} $DesktopShortcutState == ${BST_UNCHECKED}
      ${If} ${FileExists} "$newDesktopLink"
        WinShell::UninstShortcut "$newDesktopLink"
        Delete "$newDesktopLink"
      ${EndIf}
      ${If} $oldDesktopLink != $newDesktopLink
      ${AndIf} ${FileExists} "$oldDesktopLink"
        WinShell::UninstShortcut "$oldDesktopLink"
        Delete "$oldDesktopLink"
      ${EndIf}
  ${EndIf}
!macroend
!endif
