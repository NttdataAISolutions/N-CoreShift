@echo off
title N-CoreShift — Stop
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Add-Type -AssemblyName System.Windows.Forms; " ^
  "Add-Type -AssemblyName System.Drawing; " ^
  "" ^
  "$form = New-Object System.Windows.Forms.Form; " ^
  "$form.Text = 'N-CoreShift — Stopping'; " ^
  "$form.Size = New-Object System.Drawing.Size(420,160); " ^
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
  "$title.Size = New-Object System.Drawing.Size(370,28); " ^
  "$form.Controls.Add($title); " ^
  "" ^
  "$status = New-Object System.Windows.Forms.Label; " ^
  "$status.Text = 'Stopping all N-CoreShift processes...'; " ^
  "$status.Font = New-Object System.Drawing.Font('Segoe UI',9); " ^
  "$status.ForeColor = [System.Drawing.Color]::FromArgb(255,160,80); " ^
  "$status.Location = New-Object System.Drawing.Point(20,60); " ^
  "$status.Size = New-Object System.Drawing.Size(370,20); " ^
  "$form.Controls.Add($status); " ^
  "" ^
  "$bar = New-Object System.Windows.Forms.ProgressBar; " ^
  "$bar.Location = New-Object System.Drawing.Point(20,88); " ^
  "$bar.Size = New-Object System.Drawing.Size(370,16); " ^
  "$bar.Style = 'Marquee'; " ^
  "$bar.MarqueeAnimationSpeed = 40; " ^
  "$form.Controls.Add($bar); " ^
  "" ^
  "$timer = New-Object System.Windows.Forms.Timer; " ^
  "$timer.Interval = 600; " ^
  "$step = 0; " ^
  "" ^
  "$timer.Add_Tick({ " ^
  "  $step++; " ^
  "  if ($step -eq 1) { " ^
  "    $status.Text = 'Killing Vite (port 5173)...'; " ^
  "    Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; " ^
  "  } elseif ($step -eq 2) { " ^
  "    $status.Text = 'Stopping node processes...'; " ^
  "    Get-Process -Name 'node' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; " ^
  "  } elseif ($step -eq 3) { " ^
  "    $status.Text = 'Done. All N-CoreShift services stopped.'; " ^
  "    $status.ForeColor = [System.Drawing.Color]::FromArgb(80,220,120); " ^
  "    $bar.Style = 'Continuous'; " ^
  "    $bar.Value = 100; " ^
  "    $timer.Stop(); " ^
  "    Start-Sleep -Milliseconds 1200; " ^
  "    $form.Close(); " ^
  "  }; " ^
  "}); " ^
  "" ^
  "$form.Add_Shown({ $timer.Start() }); " ^
  "$form.ShowDialog() | Out-Null"

endlocal
