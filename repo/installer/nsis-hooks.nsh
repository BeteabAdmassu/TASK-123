; TalentOps NSIS installer hooks
; Called by electron-builder during NSIS packaging.

!macro customInstall
  ; Run post-install PowerShell script to initialize PostgreSQL and database
  nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\scripts\post-install.ps1"'
!macroend

!macro customUnInstall
  ; Run pre-uninstall PowerShell script to clean up
  nsExec::ExecToLog 'powershell.exe -ExecutionPolicy Bypass -File "$INSTDIR\resources\installer\scripts\pre-uninstall.ps1"'
!macroend
