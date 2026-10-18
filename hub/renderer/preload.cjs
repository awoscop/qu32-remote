// Admin window preload: a small, explicit API. No Node access in the page.
const { contextBridge, ipcRenderer } = require("electron");

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("hub", {
  getState: call("hub:getState"),
  setCount: call("hub:setCount"),
  updateSlot: call("hub:updateSlot"),
  regenerate: call("hub:regenerate"),
  setMixerHost: call("hub:setMixerHost"),
  setLanIp: call("hub:setLanIp"),
  resetEngineerPassword: call("hub:resetEngineerPassword"),
  dismissFirstPassword: call("hub:dismissFirstPassword"),
  audioDevices: call("hub:audioDevices"),
  setAudio: call("hub:setAudio"),
  setTalkback: call("hub:setTalkback"),
  talk: call("hub:talk"),
  copy: call("hub:copy"),
  openDataFolder: call("hub:openDataFolder"),
  openUrl: call("hub:openUrl"),
  qrSheet: call("hub:qrSheet"),
  mixAssign: call("hub:mix:assign"),
  mixChannel: call("hub:mix:channel"),
  mixMaster: call("hub:mix:master"),
  showNew: call("hub:show:new"),
  showSave: call("hub:show:save"),
  showLoad: call("hub:show:load"),
  showDelete: call("hub:show:delete"),
  showExport: call("hub:show:export"),
  showImport: call("hub:show:import"),
});
