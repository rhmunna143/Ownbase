import { contextBridge, ipcRenderer } from 'electron';

export interface ThinClientAPI {
  isElectron: boolean;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  openExternal: (url: string) => void;
  startService: () => Promise<{ success: boolean; error?: string }>;
}

const thinClientApi: ThinClientAPI = {
  isElectron: true,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),
  startService: () => ipcRenderer.invoke('service:start'),
};

contextBridge.exposeInMainWorld('thinClientAPI', thinClientApi);
