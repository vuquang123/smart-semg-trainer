Option Explicit

Dim fso, shell, scriptDir, repoRoot, appDir, distIndex, url, http, isRunning
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
appDir = fso.BuildPath(repoRoot, "web")
distIndex = fso.BuildPath(appDir, "dist\index.html")
url = "http://localhost:8787"

If Not fso.FileExists(distIndex) Then
    MsgBox "Chua tim thay ban build Web App tai:" & vbCrLf & distIndex & vbCrLf & vbCrLf & _
           "Hay mo PowerShell trong thu muc 'web' va chay:" & vbCrLf & _
           "  npm ci" & vbCrLf & _
           "  npm run build", vbExclamation, "SMART sEMG TRAINER"
    WScript.Quit 1
End If

' Kiem tra xem server cong 8787 da chay ngam tu truoc chua
isRunning = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 500, 500, 500, 500
http.Open "GET", "http://127.0.0.1:8787/", False
http.Send
If Err.Number = 0 And http.Status = 200 Then
    isRunning = True
End If
On Error GoTo 0

' Neu chua chay thi khoi dong server ngam (0 = An hoan toan cua so Terminal)
If Not isRunning Then
    shell.CurrentDirectory = appDir
    shell.Run "cmd.exe /c ""set SEMG_EMULATOR_HOST=0.0.0.0 && node scripts/esp32-emulator.mjs""", 0, False
    WScript.Sleep 1800
End If

' Mo giao dien duoi dang Cua so Ung dung doc lap (App Mode) tren Edge hoac Chrome
On Error Resume Next
Err.Clear
shell.Run "msedge.exe --app=" & url, 1, False
If Err.Number <> 0 Then
    Err.Clear
    shell.Run "chrome.exe --app=" & url, 1, False
    If Err.Number <> 0 Then
        shell.Run url, 1, False
    End If
End If
On Error GoTo 0
