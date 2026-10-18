// Hidden audio-engine window preload: command channel to the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engine", {
  onCommand: (fn) => ipcRenderer.on("audio:cmd", (_e, id, method, args) => fn(id, method, args)),
  reply: (id, ok, value) => ipcRenderer.send("audio:reply", id, ok, value),
  status: (s) => ipcRenderer.send("audio:status", s),
});
