Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
  Where-Object { $_.CommandLine -match 'remote-debugging' } |
  Select-Object -First 2 -ExpandProperty CommandLine
