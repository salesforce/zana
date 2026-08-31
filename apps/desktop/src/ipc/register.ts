import { bindIpcCtx, type IpcCtx } from './ctx.js';
import { registerProjectsIpc } from './projects.js';
import { registerWindowsIpc } from './windows.js';
import { registerTerminalsIpc } from './terminals.js';
import { registerConfigIpc } from './config.js';
import { registerExecutionIpc } from './execution.js';
import { registerSessionsIpc } from './sessions.js';
import { registerFsIpc } from './fs.js';
import { registerInboxIpc } from './inbox.js';
import { registerAgentsIpc } from './agents.js';
import { registerSavedIpc } from './saved.js';
import { registerPluginsIpc } from './plugins.js';
import { registerExtensionsIpc } from './extensions.js';
import { registerSkillsIpc } from './skills.js';
import { registerSettingsIpc } from './settings.js';
import { registerAppIpc } from './app.js';
import { registerSchedulerIpc } from './scheduler.js';
import { registerPersonasIpc } from './personas.js';
import { registerVoiceIpc } from './voice.js';
import { registerModulesIpc } from './modules.js';
import { registerHostsPairingIpc } from './hosts-pairing.js';

export function registerIpcFamilies(host: IpcCtx): void {
  bindIpcCtx(host);
  registerProjectsIpc();
  registerWindowsIpc();
  registerTerminalsIpc();
  registerConfigIpc();
  registerExecutionIpc();
  registerSessionsIpc();
  registerFsIpc();
  registerInboxIpc();
  registerAgentsIpc();
  registerSavedIpc();
  registerPluginsIpc();
  registerExtensionsIpc();
  registerSkillsIpc();
  registerSettingsIpc();
  registerAppIpc();
  registerSchedulerIpc();
  registerPersonasIpc();
  registerVoiceIpc();
  registerModulesIpc();
  registerHostsPairingIpc();
}

