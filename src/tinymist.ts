import { app } from "electron";
import path from "node:path";

const executableName =
  process.platform === "win32" ? "tinymist.exe" : "tinymist";

/**
 * Development uses the developer's PATH. Packaged applications use the
 * executable copied next to app.asar by Electron Packager.
 */
export function tinymistExecutable() {
  return app.isPackaged
    ? path.join(process.resourcesPath, executableName)
    : executableName;
}
