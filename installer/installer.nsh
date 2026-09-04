; Manuel ilk kurulumu degistirmeden birakir. Electron-updater --updated ile
; calistirdiginda yalniz NSIS kurulum/ilerleme sayfasi gorunur; bittiginde Finish
; beklemeden yeni Katip surumu acilir.
!macro customFinishPage
  Function KatipStartAppFromFinish
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function KatipFinishPagePre
    ${if} ${isUpdated}
      HideWindow
      Call KatipStartAppFromFinish
      Abort
    ${endif}
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE KatipFinishPagePre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "KatipStartAppFromFinish"
  !insertmacro MUI_PAGE_FINISH
!macroend
