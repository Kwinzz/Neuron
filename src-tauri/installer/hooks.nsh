; Neuron — NSIS installer hooks (bundle > windows > nsis > installerHooks).
; Paired with our custom NSIS template (`installer/installer.nsi`), which handles: admin rights (perMachine),
; updating existing installations in place, fresh-install options page (`$NeuronAutostart`, `$NeuronCliPath`),
; closing a running Neuron, Start menu + desktop shortcuts, « Lancer Neuron ».

; Same entry as the app's « Lancer avec Windows » setting (tauri-plugin-autostart: value named after the
; product, `--background` = start hidden in the tray). The app adopts it as its setting on first launch.
!define NEURON_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define NEURON_STARTUP_APPROVED "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

!macro NSIS_HOOK_POSTINSTALL
  ; `neuron` command line: a .cmd shim in bin\ (cmd and PowerShell wait for it and show its output, unlike a direct
  ; call to the windowed exe). Rewritten at every install, updates included.
  CreateDirectory "$INSTDIR\bin"
  FileOpen $0 "$INSTDIR\bin\neuron.cmd" w
  FileWrite $0 '@"%~dp0..\${MAINBINARYNAME}.exe" %*$\r$\n'
  FileClose $0
  ; Update (/UPDATE or installing over an existing install): previous choices are kept.
  ${If} $UpdateMode = 1
    Goto neuron_postinstall_done
  ${EndIf}
  ; Language picked in the installer's selector → Neuron's interface language at first launch (read by
  ; `i18n::detect`). 1036 = French; anything else = English.
  ${If} $LANGUAGE = 1036
    WriteRegStr HKCU "Software\Neuron" "Language" "fr"
  ${Else}
    WriteRegStr HKCU "Software\Neuron" "Language" "en"
  ${EndIf}
  ; Choices from the options page (or silent defaults: autostart off, CLI path on).
  ${If} $NeuronAutostart = 1
    WriteRegStr HKCU "${NEURON_RUN_KEY}" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --background'
  ${EndIf}
  ; `neuron` in the terminal: the user PATH is edited by the app itself (NSIS strings would truncate a long PATH).
  ${If} $NeuronCliPath = 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --cli-path add'
  ${EndIf}
  neuron_postinstall_done:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Update: the new version is installed over this one, choices kept.
  ${If} $UpdateMode = 1
    Goto neuron_preuninstall_done
  ${EndIf}
  ; `neuron` command line: out of the PATH, shim removed.
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --cli-path remove'
  Delete "$INSTDIR\bin\neuron.cmd"
  RMDir "$INSTDIR\bin"
  ; Nothing of Neuron must start at login once it is gone.
  DeleteRegValue HKCU "${NEURON_RUN_KEY}" "${PRODUCTNAME}"
  DeleteRegValue HKCU "${NEURON_STARTUP_APPROVED}" "${PRODUCTNAME}"
  ; Notification identity registered by the app (name + icon of its toasts).
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${BUNDLEID}"
  ; Installer language choice.
  DeleteRegKey HKCU "Software\Neuron"
  neuron_preuninstall_done:
!macroend
