@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=C:\proj\node_modules\.pnpm\tool@1.0.0\node_modules;C:\proj\node_modules\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=C:\proj\node_modules\.pnpm\tool@1.0.0\node_modules;C:\proj\node_modules\.pnpm\node_modules;%NODE_PATH%"
)
@"%~dp0\..\src\tool.exe"   %*
