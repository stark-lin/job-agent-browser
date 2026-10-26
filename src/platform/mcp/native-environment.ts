/** Trusted OS session fields required by Electron PDF workers launched through stdio MCP. */
export function nativeMCPEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of ['DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'SystemRoot', 'WINDIR', 'COMSPEC', 'LOCALAPPDATA', 'APPDATA']) {
    if (process.env[name]) env[name] = process.env[name]!
  }
  return env
}
