@echo off
title N-CoreShift Launcher
setlocal

:: ─── Configuration ───────────────────────────────────────────────────────────
set "ROOT=c:\N-CoreShift"
set "APP_PORT=5173"
set "API_PORT=4004"
set "APP_URL=http://127.0.0.1:%APP_PORT%"
set "API_URL=http://127.0.0.1:%API_PORT%"

:: ─── Launch the popup timer + both servers in one PowerShell call ─────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.Windows.Forms; " ^
  "Add-Type -AssemblyName System.Drawing; " ^
  "" ^
  "$form = New-Object System.Windows.Forms.Form; " ^
  "$form.Text = 'N-CoreShift — Starting'; " ^
  "$form.Size = New-Object System.Drawing.Size(440,230); " ^
  "$form.StartPosition = 'CenterScreen'; " ^
  "$form.FormBorderStyle = 'FixedDialog'; " ^
  "$form.MaximizeBox = $false; " ^
  "$form.MinimizeBox = $false; " ^
  "$form.BackColor = [System.Drawing.Color]::FromArgb(26,26,46); " ^
  "" ^
  "$title = New-Object System.Windows.Forms.Label; " ^
  "$title.Text = 'N-CoreShift'; " ^
  "$title.Font = New-Object System.Drawing.Font('Segoe UI',14,[System.Drawing.FontStyle]::Bold); " ^
  "$title.ForeColor = [System.Drawing.Color]::White; " ^
  "$title.Location = New-Object System.Drawing.Point(20,18); " ^
  "$title.Size = New-Object System.Drawing.Size(390,28); " ^
  "$form.Controls.Add($title); " ^
  "" ^
  "$sub = New-Object System.Windows.Forms.Label; " ^
  "$sub.Text = 'AI-powered SAP Clean Core Modernization Platform'; " ^
  "$sub.Font = New-Object System.Drawing.Font('Segoe UI',8); " ^
  "$sub.ForeColor = [System.Drawing.Color]::FromArgb(160,160,200); " ^
  "$sub.Location = New-Object System.Drawing.Point(20,48); " ^
  "$sub.Size = New-Object System.Drawing.Size(390,18); " ^
  "$form.Controls.Add($sub); " ^
  "" ^
  "$status = New-Object System.Windows.Forms.Label; " ^
  "$status.Text = 'Starting Vite (UI) + Express (API) servers...'; " ^
  "$status.Font = New-Object System.Drawing.Font('Segoe UI',9); " ^
  "$status.ForeColor = [System.Drawing.Color]::FromArgb(100,210,255); " ^
  "$status.Location = New-Object System.Drawing.Point(20,78); " ^
  "$status.Size = New-Object System.Drawing.Size(390,20); " ^
  "$form.Controls.Add($status); " ^
  "" ^
  "$status2 = New-Object System.Windows.Forms.Label; " ^
  "$status2.Text = '  UI  :5173   API  :4004'; " ^
  "$status2.Font = New-Object System.Drawing.Font('Consolas',8); " ^
  "$status2.ForeColor = [System.Drawing.Color]::FromArgb(140,140,180); " ^
  "$status2.Location = New-Object System.Drawing.Point(20,100); " ^
  "$status2.Size = New-Object System.Drawing.Size(390,18); " ^
  "$form.Controls.Add($status2); " ^
  "" ^
  "$bar = New-Object System.Windows.Forms.ProgressBar; " ^
  "$bar.Location = New-Object System.Drawing.Point(20,126); " ^
  "$bar.Size = New-Object System.Drawing.Size(390,16); " ^
  "$bar.Style = 'Marquee'; " ^
  "$bar.MarqueeAnimationSpeed = 30; " ^
  "$form.Controls.Add($bar); " ^
  "" ^
  "$elapsed = New-Object System.Windows.Forms.Label; " ^
  "$elapsed.Text = 'Elapsed: 0s'; " ^
  "$elapsed.Font = New-Object System.Drawing.Font('Segoe UI',8); " ^
  "$elapsed.ForeColor = [System.Drawing.Color]::FromArgb(140,140,170); " ^
  "$elapsed.Location = New-Object System.Drawing.Point(20,150); " ^
  "$elapsed.Size = New-Object System.Drawing.Size(390,18); " ^
  "$form.Controls.Add($elapsed); " ^
  "" ^
  "$timer = New-Object System.Windows.Forms.Timer; " ^
  "$timer.Interval = 500; " ^
  "$seconds = 0; " ^
  "$started = $false; " ^
  "" ^
  "$timer.Add_Tick({ " ^
  "  $seconds += 0.5; " ^
  "  $elapsed.Text = 'Elapsed: ' + [int]$seconds + 's'; " ^
  "  if (-not $started) { " ^
  "    $started = $true; " ^
  "    Start-Job -ScriptBlock { " ^
  "      Start-Process -NoNewWindow -FilePath 'C:\N-CoreShift\node_modules\.bin\vite.cmd' " ^
  "        -ArgumentList '--port','5173','--host','127.0.0.1' " ^
  "        -WorkingDirectory 'C:\N-CoreShift\app' " ^
  "    } | Out-Null; " ^
  "    Start-Job -ScriptBlock { " ^
  "      $env:NODE_ENV = 'development'; " ^
  "      Start-Process -NoNewWindow -FilePath 'node' " ^
  "        -ArgumentList 'c:\N-CoreShift\srv\node_modules\ts-node\dist\bin.js','-P','c:\N-CoreShift\srv\tsconfig.json','src/server.ts' " ^
  "        -WorkingDirectory 'c:\N-CoreShift\srv' " ^
  "    } | Out-Null; " ^
  "  }; " ^
  "  $uiUp = $false; " ^
  "  $apiUp = $false; " ^
  "  try { Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop | Out-Null; $uiUp = $true; } catch { }; " ^
  "  try { Invoke-WebRequest -Uri 'http://127.0.0.1:4004/health' -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop | Out-Null; $apiUp = $true; } catch { }; " ^
  "  if ($uiUp -and $apiUp) { " ^
  "    $status.Text = 'Both servers ready! Opening browser...'; " ^
  "    $status.ForeColor = [System.Drawing.Color]::FromArgb(80,220,120); " ^
  "    $bar.Style = 'Continuous'; " ^
  "    $bar.Value = 100; " ^
  "    $timer.Stop(); " ^
  "    Start-Sleep -Milliseconds 800; " ^
  "    Start-Process 'http://127.0.0.1:5173'; " ^
  "    $form.Close(); " ^
  "  } elseif ($uiUp) { " ^
  "    $status2.Text = '  UI :5173 [OK]   API :4004 [waiting...]'; " ^
  "    $status2.ForeColor = [System.Drawing.Color]::FromArgb(180,210,140); " ^
  "  } elseif ($seconds -gt 60) { " ^
  "    $status.Text = 'Timeout — check console for errors.'; " ^
  "    $status.ForeColor = [System.Drawing.Color]::FromArgb(255,120,120); " ^
  "    $timer.Stop(); " ^
  "  }; " ^
  "}); " ^
  "" ^
  "$form.Add_Shown({ $timer.Start() }); " ^
  "$form.ShowDialog() | Out-Null"

endlocal
