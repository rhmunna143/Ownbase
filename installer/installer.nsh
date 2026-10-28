!macro customInit
  ; Gracefully stop running Ownbase Windows Service if installed
  nsExec::Exec 'cmd.exe /c net stop ownbase'
  ; Terminate any running WinSW service wrapper
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "ownbase-service.exe"'
  ; Terminate any running desktop viewer or background daemon instances
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "Ownbase.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "Native Windows Server Hub.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "postgres.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "pg_ctl.exe"'
  Sleep 1000
!macroend

!macro customUnInstall
  ; Stop service and kill processes on uninstall
  nsExec::Exec 'cmd.exe /c net stop ownbase'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "ownbase-service.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "Ownbase.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "Native Windows Server Hub.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "postgres.exe"'
  nsExec::Exec 'cmd.exe /c taskkill /F /IM "pg_ctl.exe"'
  Sleep 1000
!macroend
