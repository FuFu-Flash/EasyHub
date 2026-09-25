!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var DesktopShortcutCheckbox
Var DesktopShortcutState

!macro customPageAfterChangeDir
  Page custom ShortcutPageCreate ShortcutPageLeave
!macroend

Function ShortcutPageCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "选择安装选项。"
  Pop $0
  ${NSD_CreateCheckbox} 0 30u 100% 16u "创建桌面快捷方式"
  Pop $DesktopShortcutCheckbox
  ${NSD_Check} $DesktopShortcutCheckbox
  nsDialogs::Show
FunctionEnd

Function ShortcutPageLeave
  ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutState
FunctionEnd

!macro customInstall
  ${IfNot} ${Silent}
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
  ${EndIf}
!macroend
!endif
