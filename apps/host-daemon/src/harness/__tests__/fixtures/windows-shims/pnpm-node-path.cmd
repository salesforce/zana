@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=C:\proj\node_modules\.pnpm\@fixture+echo-cli@file+..+pkg\node_modules\@fixture\echo-cli\node_modules;C:\proj\node_modules\.pnpm\@fixture+echo-cli@file+..+pkg\node_modules;C:\proj\node_modules\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=C:\proj\node_modules\.pnpm\@fixture+echo-cli@file+..+pkg\node_modules\@fixture\echo-cli\node_modules;C:\proj\node_modules\.pnpm\@fixture+echo-cli@file+..+pkg\node_modules;C:\proj\node_modules\.pnpm\node_modules;%NODE_PATH%"
)
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\@fixture\echo-cli\bin\echo-cli.js" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\@fixture\echo-cli\bin\echo-cli.js" %*
)
