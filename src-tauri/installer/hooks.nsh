; Neuron — NSIS installer hooks (bundle > windows > nsis > installerHooks).
; The Tauri template already handles: admin rights (perMachine), detection of an existing installation
; (uninstall / reinstall choice), closing a running Neuron, Start menu + desktop shortcuts, « Lancer Neuron ».

; Same entry as the app's « Lancer avec Windows » setting (tauri-plugin-autostart: value named after the
; product, `--background` = start hidden in the tray). The app adopts it as its setting on first launch.
!define NEURON_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define NEURON_STARTUP_APPROVED "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

!macro NSIS_HOOK_POSTINSTALL
  ; Language picked in the installer's selector → Neuron's interface language at first launch (read by
  ; `i18n::detect`). 1036 = French; anything else = English.
  StrCmp $LANGUAGE 1036 neuron_lang_fr neuron_lang_en
  neuron_lang_fr:
    WriteRegStr HKCU "Software\Neuron" "Language" "fr"
    MessageBox MB_YESNO|MB_ICONQUESTION "Lancer Neuron automatiquement à l'ouverture de session Windows ?$\r$\n$\r$\nNeuron démarre alors discrètement dans la zone de notification (près de l'horloge) : tes agents, tes notifications et la demande rapide restent disponibles.$\r$\n$\r$\nModifiable à tout moment dans Paramètres › Arrière-plan & raccourci." /SD IDNO IDNO neuron_skip_autostart
    Goto neuron_autostart
  neuron_lang_en:
    WriteRegStr HKCU "Software\Neuron" "Language" "en"
    MessageBox MB_YESNO|MB_ICONQUESTION "Start Neuron automatically when you sign in to Windows?$\r$\n$\r$\nNeuron then starts quietly in the notification area (next to the clock): your agents, notifications and the quick prompt stay available.$\r$\n$\r$\nYou can change this anytime in Settings › Background & shortcut." /SD IDNO IDNO neuron_skip_autostart
  neuron_autostart:
    WriteRegStr HKCU "${NEURON_RUN_KEY}" "${PRODUCTNAME}" '"$INSTDIR\${MAINBINARYNAME}.exe" --background'
  neuron_skip_autostart:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Nothing of Neuron must start at login once it is gone.
  DeleteRegValue HKCU "${NEURON_RUN_KEY}" "${PRODUCTNAME}"
  DeleteRegValue HKCU "${NEURON_STARTUP_APPROVED}" "${PRODUCTNAME}"
  ; Notification identity registered by the app (name + icon of its toasts).
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\${BUNDLEID}"
  ; Installer language choice.
  DeleteRegKey HKCU "Software\Neuron"
!macroend
