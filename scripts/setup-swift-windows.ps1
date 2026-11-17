# Official Swift installer on an ephemeral Windows CI runner; never used to modify a user's PC.
$ErrorActionPreference = 'Stop'
$version = '6.4.2'
$installer = Join-Path $env:RUNNER_TEMP 'swift-6.4.2-windows.exe'
$url = 'https://download.swift.org/swift-6.4.2-release/windows10/swift-6.4.2-RELEASE/swift-6.4.2-RELEASE-windows10.exe'
Invoke-WebRequest -Uri $url -OutFile $installer -TimeoutSec 600
Get-FileHash $installer -Algorithm SHA256 | Format-List
$process = Start-Process -FilePath $installer -ArgumentList @('/quiet', '/norestart', '/log', (Join-Path $env:RUNNER_TEMP 'swift-install.log')) -Wait -PassThru
if ($process.ExitCode -notin @(0, 3010)) { throw "Swift installer failed: $($process.ExitCode)" }

# Refresh only toolchain settings, rather than copying credentials or all environment variables.
foreach ($key in @('Path', 'SDKROOT', 'DEVELOPER_DIR')) {
    $values = foreach ($scope in @('Machine', 'User')) {
        [Environment]::GetEnvironmentVariable($key, $scope)
    }
    if ($key -eq 'Path') {
        $values = @($env:Path) + $values
        $value = (($values | Where-Object { $_ }) -join ';')
    } else { $value = $values | Where-Object { $_ } | Select-Object -Last 1 }
    if ($value) {
        Set-Item "Env:$key" $value
        if ($key -ne 'Path') { "$key=$value" | Out-File $env:GITHUB_ENV -Encoding utf8 -Append }
    }
}
$swiftRoots = @((Join-Path $env:LOCALAPPDATA 'Programs/Swift'), (Join-Path $env:ProgramFiles 'Swift'))
foreach ($root in $swiftRoots) {
    foreach ($kind in @('Toolchains', 'Runtimes')) {
        Get-ChildItem "$root/$kind/*/usr/bin" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $env:Path += ";$($_.FullName)"
        }
    }
}
$paths = @($env:Path -split ';' | Where-Object { $_ } | Select-Object -Unique)
[Array]::Reverse($paths)
$paths | Out-File $env:GITHUB_PATH -Encoding utf8 -Append
swift --version
if ($LASTEXITCODE -ne 0) { throw 'Installed Swift does not start' }
swiftc --version
if ($LASTEXITCODE -ne 0) { throw 'Installed Swift compiler does not start' }
