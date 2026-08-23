# agent_monitor.ps1 — watches for foreign-agent interference with the music pipeline.
# Logs to H:\shibass-ai\07_LOGS\agent_monitor.log every 30s:
#   * who listens on 8788 (must be music_brain) and 8789 (synths studio)
#   * whether synths_midi_server.py was reverted (upgrade markers gone)
#   * timestamped evidence lines — read it to see exactly what happened while you were away.
$log = 'H:\shibass-ai\07_LOGS\agent_monitor.log'
$synth = 'H:\shibass-ai\services\synths_midi_player\synths_midi_server.py'
New-Item -ItemType Directory -Path (Split-Path $log) -Force | Out-Null

function W($msg) {
    $line = "[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $msg
    Add-Content -Path $log -Value $line -Encoding UTF8
    Write-Host $line
}

W "=== monitor started (pid $PID) ==="
$lastState = ""
while ($true) {
    $state = @()
    foreach ($port in 8788, 8791) {
        $pids = Get-NetTCPConnection -LocalPort $port -State Listen -EA 0 |
                Select-Object -ExpandProperty OwningProcess -Unique
        if (-not $pids) { $state += "${port}:DOWN"; continue }
        foreach ($p in $pids) {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$p" -EA 0).CommandLine
            $who = if ($cmd -match 'music_brain serve') { 'music_brain' }
                   elseif ($cmd -match 'synths_midi_server') { 'synths_studio' }
                   else { 'UNKNOWN(' + ($cmd -replace '\s+', ' ' | ForEach-Object { $_.Substring(0, [Math]::Min(60, $_.Length)) }) + ')' }
            $state += "${port}:$who"
        }
    }
    $reverted = -not (Select-String -Path $synth -Pattern 'SYNTHS_PORT' -Quiet -EA 0)
    if ($reverted) { $state += "SYNTH-FILE:REVERTED-BY-AGENT" }
    $cur = $state -join ' | '
    if ($cur -ne $lastState) {
        W "CHANGE: $cur"
        # Peace treaty: 8788=synth studio (Antigravity), 8791=music_brain (MIDI Forge).
        if ($cur -match 'UNKNOWN|REVERTED|8791:synths|8788:music_brain|8791:DOWN') { W "  ^^ interference detected" }
        $lastState = $cur
    }
    Start-Sleep -Seconds 30
}
