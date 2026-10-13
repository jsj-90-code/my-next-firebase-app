# Run this installer from the destination Codex chat on EACH Windows PC.
# It uses that PC's existing SSH key and CODEX_THREAD_ID; credentials are not copied.
# Example: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/pingMonitor/notifications/install.ps1
# The task polls every five minutes while ChatGPT/Codex is running, queues new
# results into the configured local chat, and keeps per-PC duplicate suppression.
# To stop notifications only: Disable-ScheduledTask -TaskName Codex-PingMonitor-ResultNotify
# Server measurements continue independently when this PC is off.
param(
    [string]$ThreadId = $env:CODEX_THREAD_ID,
    [string]$SshKey = (Join-Path $env:USERPROFILE '.ssh/oci_ping_monitor')
)
$ErrorActionPreference = 'Stop'
if ($ThreadId -notmatch '^[0-9a-fA-F-]{36}$') { throw 'Run from the destination Codex chat, or pass -ThreadId <session UUID>.' }
if (-not (Test-Path -LiteralPath $SshKey -PathType Leaf)) { throw "Existing server SSH key not found: $SshKey" }
$workspacePath = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$installPath = Join-Path $env:USERPROFILE '.codex/ping-monitor-notify'
New-Item -ItemType Directory -Force -Path $installPath | Out-Null
$nodePath = (Get-Command node.exe).Source
$sshPath = (Get-Command ssh.exe).Source
$powershellPath = (Get-Command powershell.exe).Source
$wscriptPath = Join-Path $env:WINDIR 'System32/wscript.exe'
if (-not (Test-Path -LiteralPath $wscriptPath)) { throw 'Windows Script Host is required for a console-free scheduled launch.' }
$codexCommand = (Get-Command codex).Source
if ([IO.Path]::GetExtension($codexCommand) -eq '.exe') {
    $codexExecutable = $codexCommand
    $codexPrefix = @()
} else {
    $codexEntry = Join-Path (Split-Path $codexCommand) 'node_modules/@openai/codex/bin/codex.js'
    if (-not (Test-Path -LiteralPath $codexEntry)) { throw 'Codex CLI entrypoint not found.' }
    $codexExecutable = $nodePath
    $codexPrefix = @($codexEntry)
}
$taskName = 'Codex-PingMonitor-ResultNotify'
$configPath = Join-Path $installPath 'config.json'
if (Test-Path -LiteralPath $configPath) {
    $oldConfig = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($oldConfig.threadId -ne $ThreadId) { throw 'An existing notification targets a different chat. Review that destination before reinstalling.' }
} elseif (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw 'An unrelated task already uses this task name.'
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'watch.mjs') -Destination (Join-Path $installPath 'watch.mjs') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'snapshot.py') -Destination (Join-Path $installPath 'snapshot.py') -Force
$config = @{ threadId=$ThreadId; workspace=$workspacePath; sshKey=$SshKey; ssh=$sshPath; powershell=$powershellPath; codexExecutable=$codexExecutable; codexPrefix=$codexPrefix }
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), $utf8)
$watchPath = Join-Path $installPath 'watch.mjs'
& $nodePath $watchPath $configPath
if ($LASTEXITCODE -ne 0) { throw 'Initial server/notification check failed; no scheduled task was installed.' }
# powershell.exe -WindowStyle Hidden can briefly create a console before hiding it.
# The GUI script host starts Node hidden from the outset and preserves its exit code.
$runner = Join-Path $installPath 'run-hidden.vbs'
$launchCommand = '"' + $nodePath + '" "' + $watchPath + '" "' + $configPath + '"'
$runnerText = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'WScript.Quit shell.Run("' + $launchCommand.Replace('"','""') + '", 0, True)' + "`r`n"
[IO.File]::WriteAllText($runner, $runnerText, [Text.Encoding]::Unicode)
$action = New-ScheduledTaskAction -Execute $wscriptPath -Argument ('//B //NoLogo "' + $runner + '"') -WorkingDirectory $workspacePath
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$accountName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$login = New-ScheduledTaskTrigger -AtLogOn -User $accountName
$principal = New-ScheduledTaskPrincipal -UserId $accountName -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($repeat,$login) -Principal $principal -Settings $settings -Description 'Report newly completed ping observations and repeated connection candidates to this PC''s Codex chat.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "Installed: $taskName"
Write-Output "Chat: $ThreadId"
Write-Output "State: $(Join-Path $installPath 'delivery.json')"
