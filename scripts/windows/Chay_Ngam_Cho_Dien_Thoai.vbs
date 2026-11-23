Option Explicit

Dim fso, shell, scriptDir, repoRoot, appDir, distIndex, http, isRunning, wmi, adapters, adapter, ip, ipList
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
appDir = fso.BuildPath(repoRoot, "web")
distIndex = fso.BuildPath(appDir, "dist\index.html")

If Not fso.FileExists(distIndex) Then
    MsgBox "Chua tim thay ban build Web App tai:" & vbCrLf & distIndex & vbCrLf & vbCrLf & _
           "Hay mo PowerShell trong thu muc 'web' va chay:" & vbCrLf & _
           "  npm ci" & vbCrLf & _
           "  npm run build", vbExclamation, "SMART sEMG TRAINER"
    WScript.Quit 1
End If

' Kiem tra xem server cong 8787 da chay ngam chua
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

' Neu chua chay thi khoi dong server ngam tren 0.0.0.0 (KHONG mo trinh duyet tren may tinh)
If Not isRunning Then
    shell.CurrentDirectory = appDir
    shell.Run "cmd.exe /c ""set SEMG_EMULATOR_HOST=0.0.0.0 && node scripts/esp32-emulator.mjs""", 0, False
    WScript.Sleep 1500
End If

' Lay dia chi IP Wi-Fi hien tai cua may tinh de hien thi cho nguoi dung nhap tren Dien thoai
ipList = ""
On Error Resume Next
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set adapters = wmi.ExecQuery("SELECT IPAddress FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled = True")
For Each adapter In adapters
    If Not IsNull(adapter.IPAddress) Then
        For Each ip In adapter.IPAddress
            If InStr(ip, ".") > 0 And ip <> "127.0.0.1" Then
                ipList = ipList & "  ->  http://" & ip & ":8787" & vbCrLf
            End If
        Next
    End If
Next
On Error GoTo 0

If ipList = "" Then
    ipList = "  ->  http://<IP-Wi-Fi-May-Tinh>:8787" & vbCrLf
End If

MsgBox "Server da chay ngam (Man hinh may tinh hoan toan ranh de chieu Slide!)." & vbCrLf & vbCrLf & _
       "Tren DIEN THOAI (cung bat chung Wi-Fi/Hotspot), hay mo Safari/Chrome va truy cap:" & vbCrLf & vbCrLf & _
       ipList & vbCrLf & _
       "Sau do vao muc 'Thiet bi' tren dien thoai de ket noi ESP32 (ws://<IP-ESP32>/ws) hoac tap Mo phong.", _
       vbInformation, "SMART sEMG TRAINER - Demo Tren Dien Thoai"
