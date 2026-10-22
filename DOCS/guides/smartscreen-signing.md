# Microsoft Defender SmartScreen & Smart App Control Guide

**Document Version:** 1.0.0  
**Scope:** Running unsigned local community builds and enterprise code signing workflows on Windows 10/11.

---

## 1. Background: Why SmartScreen Triggers

Microsoft Windows incorporates two protective layers:
1. **Windows Defender SmartScreen:** A reputation-based security filter built into Windows 10 and 11. Any freshly compiled or newly downloaded executable without a high reputation score in Microsoft's telemetry cloud triggers an alert:  
   *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
2. **Smart App Control (SAC):** A strict security feature introduced in Windows 11 (22H2) that blocks executables lacking a valid digital certificate issued by an authenticated Certificate Authority (CA).

Because open-source and local builds of Ownbase are distributed unsigned by default to avoid expensive EV (Extended Validation) code-signing certificates, Windows may show these warnings during first launch.

---

## 2. Running Community / Unsigned Builds

### Method 1: The "More Info" SmartScreen Bypass (Standard Windows 10 & 11)
1. Double-click `Native Windows Server Hub-Setup-1.0.0.exe` or `Native Windows Server Hub-Portable-1.0.0.exe`.
2. When the blue "Windows protected your PC" dialog appears:
   - Click the underlined text **"More info"**.
   - A button labeled **"Run anyway"** will appear in the bottom right corner.
   - Click **Run anyway**.
3. The installer or portable executable will launch normally.

### Method 2: Unblocking Downloaded Files via PowerShell
When an executable is downloaded from a web browser, Windows marks it with an NTFS **Zone.Identifier** Alternate Data Stream indicating it originated from the internet.

To unblock the executable directly:
```powershell
Unblock-File -Path ".\Native Windows Server Hub-Setup-1.0.0.exe"
```
Or right-click the `.exe` file in File Explorer > **Properties** > Check the **Unblock** checkbox at the bottom > Click **Apply**.

---

## 3. Production & Enterprise Code Signing Guide

For enterprise deployments or commercial distributions, Ownbase supports automated Authenticode code signing using Microsoft `signtool.exe` or cloud key vaults.

### Signing Configuration in `electron-builder.json`
To sign production binaries, update the `"win"` section of `electron-builder.json`:

```json
"win": {
  "target": ["nsis", "portable"],
  "icon": "assets/icon.ico",
  "certificateFile": "path/to/certificate.pfx",
  "certificatePassword": "${env.CERT_PASSWORD}",
  "signingHashAlgorithms": ["sha256"],
  "publisherName": "Your Organization Name",
  "rfc3161TimeStampServer": "http://timestamp.digicert.com"
}
```

### Self-Signed Certificate Creation for Internal Networks
For private networks or enterprise testing:

```powershell
# 1. Create a self-signed code signing certificate
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=Ownbase Internal Signing" -CertStoreLocation "Cert:\CurrentUser\My"

# 2. Export certificate to PFX
$pwd = ConvertTo-SecureString -String "Pass1234!" -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath ".\ownbase-internal.pfx" -Password $pwd

# 3. Sign the executable using SignTool
signtool.exe sign /f ".\ownbase-internal.pfx" /p "Pass1234!" /tr http://timestamp.digicert.com /td sha256 /fd sha256 ".\release\Native Windows Server Hub-Setup-1.0.0.exe"
```

Once signed and deployed to target client machines with the root CA trusted, SmartScreen and Smart App Control will permit execution with zero security dialogs.
