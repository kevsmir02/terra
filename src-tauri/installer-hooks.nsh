; "Open in Terra" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerra" "" "Open in Terra"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerra" "Icon" '"$INSTDIR\terra.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerra" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInTerra\command" "" '"$INSTDIR\terra.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerra" "" "Open in Terra"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerra" "Icon" '"$INSTDIR\terra.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerra" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInTerra\command" "" '"$INSTDIR\terra.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerra" "" "Open in Terra"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerra" "Icon" '"$INSTDIR\terra.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerra" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInTerra\command" "" '"$INSTDIR\terra.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInTerra"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInTerra"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInTerra"
!macroend
