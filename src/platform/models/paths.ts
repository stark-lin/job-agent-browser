import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
export function userModelStore(platform = process.platform, env = process.env, home = homedir()) {
  if (env.JAB_MODEL_STORE) {
    if (!isAbsolute(env.JAB_MODEL_STORE)) throw new Error('MODEL_STORE_ABSOLUTE_REQUIRED')
    return env.JAB_MODEL_STORE
  }
  if (platform === 'darwin') return join(home, 'Library/Application Support/JAB/managed-models')
  if (platform === 'win32') return join((env.LOCALAPPDATA && isAbsolute(env.LOCALAPPDATA) ? env.LOCALAPPDATA : join(home, 'AppData/Local')), 'JAB/Models')
  return join((env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : join(home, '.local/share')), 'JAB/models')
}
