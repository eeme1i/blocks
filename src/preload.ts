import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("writer", {
  newWindow: () => ipcRenderer.invoke("window:new"),
  openDocument: () => ipcRenderer.invoke("document:open"),
  saveDocument: (contents: string) =>
    ipcRenderer.invoke("document:save", contents),
  saveDocumentAs: (contents: string) =>
    ipcRenderer.invoke("document:save-as", contents),
  compileTypst: (source: string) => ipcRenderer.invoke("typst:compile", source),
  exportPdf: (source: string) => ipcRenderer.invoke("typst:export-pdf", source),
  exportTypst: (source: string) =>
    ipcRenderer.invoke("typst:export-source", source),
  syncTypstLanguageServer: (source: string) =>
    ipcRenderer.invoke("typst:lsp-sync", source),
  completeTypst: (source: string, line: number, character: number) =>
    ipcRenderer.invoke("typst:lsp-complete", source, line, character),
  onTypstLanguageServerEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
      callback(value);
    ipcRenderer.on("typst:lsp-event", listener);
    return () => ipcRenderer.removeListener("typst:lsp-event", listener);
  },
  onFileCommand: (callback: (command: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown) =>
      callback(command);
    ipcRenderer.on("file:command", listener);
    return () => ipcRenderer.removeListener("file:command", listener);
  },
});
