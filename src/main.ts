import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import type { MenuItemConstructorOptions, WebContents } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TypstLanguageServer } from "./typst-language-server";

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const execFileAsync = promisify(execFile);
type WindowContext = {
  filePath: string | null;
  typstLanguageServer: TypstLanguageServer;
};
const windowContexts = new Map<number, WindowContext>();

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const webContentsId = mainWindow.webContents.id;
  mainWindow.setTitle("Untitled.blocks — blocks");

  const context: WindowContext = {
    filePath: null,
    typstLanguageServer: new TypstLanguageServer((event) => {
      if (!mainWindow.isDestroyed())
        mainWindow.webContents.send("typst:lsp-event", event);
    }),
  };
  windowContexts.set(webContentsId, context);

  mainWindow.on("closed", () => {
    windowContexts.delete(webContentsId);
    void context.typstLanguageServer.stop();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
};

function contextFor(webContents: WebContents) {
  const context = windowContexts.get(webContents.id);
  if (!context) throw new Error("This window is no longer available");
  return context;
}

function sendFileCommand(command: FileCommand) {
  BrowserWindow.getFocusedWindow()?.webContents.send("file:command", command);
}

type FileCommand = "open" | "save" | "save-as";

function installApplicationMenu() {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: createWindow,
        },
        { type: "separator" },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => sendFileCommand("open"),
        },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => sendFileCommand("save"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => sendFileCommand("save-as"),
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerDocumentHandlers() {
  ipcMain.handle("window:new", () => {
    createWindow();
  });

  ipcMain.handle("document:open", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error("This window is no longer available");
    const result = await dialog.showOpenDialog(owner, {
      properties: ["openFile"],

      filters: [
        {
          name: "Blocks Document",
          extensions: ["blocks"],
        },
      ],
    });

    if (result.canceled) {
      return null;
    }

    const filePath = result.filePaths[0];

    const contents = await readFile(filePath, "utf-8");
    contextFor(event.sender).filePath = filePath;
    owner.setTitle(`${path.basename(filePath)} — blocks`);

    return {
      filePath,
      contents,
    };
  });

  ipcMain.handle("document:save", async (event, contents: unknown) => {
    if (typeof contents !== "string") {
      throw new TypeError("Document contents must be a string");
    }

    const context = contextFor(event.sender);
    if (!context.filePath) {
      return saveAs(event.sender, contents);
    }

    await writeFile(context.filePath, contents, "utf8");
    BrowserWindow.fromWebContents(event.sender)?.setTitle(
      `${path.basename(context.filePath)} — blocks`,
    );

    return {
      filePath: context.filePath,
    };
  });

  ipcMain.handle("document:save-as", async (event, contents: unknown) => {
    if (typeof contents !== "string") {
      throw new TypeError("Document contents must be a string");
    }

    return saveAs(event.sender, contents);
  });

  ipcMain.handle("typst:compile", async (_event, source: unknown) => {
    if (typeof source !== "string")
      throw new TypeError("Typst source must be a string");
    try {
      const pages = await compileTypstSvg(source);
      return { ok: true, pages };
    } catch (error) {
      return { ok: false, error: formatTypstError(error) };
    }
  });

  ipcMain.handle("typst:lsp-sync", async (event, source: unknown) => {
    if (typeof source !== "string")
      throw new TypeError("Typst source must be a string");
    return contextFor(event.sender).typstLanguageServer.sync(source);
  });

  ipcMain.handle(
    "typst:lsp-complete",
    async (event, source: unknown, line: unknown, character: unknown) => {
      if (
        typeof source !== "string" ||
        typeof line !== "number" ||
        typeof character !== "number"
      ) {
        throw new TypeError("Invalid Typst completion request");
      }
      return contextFor(event.sender).typstLanguageServer.complete(
        source,
        line,
        character,
      );
    },
  );

  ipcMain.handle("typst:export-pdf", async (event, source: unknown) => {
    if (typeof source !== "string")
      throw new TypeError("Typst source must be a string");
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error("This window is no longer available");
    const result = await dialog.showSaveDialog(owner, {
      defaultPath: "Untitled.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath)
      return { ok: false, canceled: true, error: "" };
    try {
      await compileTypstPdf(source, result.filePath);
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      return { ok: false, canceled: false, error: formatTypstError(error) };
    }
  });

  ipcMain.handle("typst:export-source", async (event, source: unknown) => {
    if (typeof source !== "string")
      throw new TypeError("Typst source must be a string");
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner) throw new Error("This window is no longer available");
    const result = await dialog.showSaveDialog(owner, {
      defaultPath: "Untitled.typ",
      filters: [{ name: "Typst source", extensions: ["typ"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, source, "utf8");
    return { filePath: result.filePath };
  });
}

async function compileTypstSvg(source: string) {
  const tempDirectory = await mkdtemp(
    path.join(app.getPath("temp"), "blocks-typst-"),
  );
  const inputPath = path.join(tempDirectory, "document.typ");
  const svgPath = path.join(tempDirectory, "preview-{p}.svg");
  try {
    await writeFile(inputPath, source, "utf8");
    await execFileAsync("typst", [
      "compile",
      "--format",
      "svg",
      "--root",
      tempDirectory,
      inputPath,
      svgPath,
    ]);
    const pageNames = (await readdir(tempDirectory))
      .filter((name) => /^preview-\d+\.svg$/.test(name))
      .sort(
        (left, right) =>
          Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]),
      );
    return await Promise.all(
      pageNames.map(async (name) =>
        (await readFile(path.join(tempDirectory, name))).toString("base64"),
      ),
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

async function compileTypstPdf(source: string, outputPath: string) {
  const tempDirectory = await mkdtemp(
    path.join(app.getPath("temp"), "blocks-typst-"),
  );
  const inputPath = path.join(tempDirectory, "document.typ");
  try {
    await writeFile(inputPath, source, "utf8");
    await execFileAsync("typst", [
      "compile",
      "--root",
      tempDirectory,
      inputPath,
      outputPath,
    ]);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function formatTypstError(error: unknown) {
  if (error && typeof error === "object" && "stderr" in error)
    return (
      String(error.stderr).trim() || "Typst could not compile this document."
    );
  return error instanceof Error
    ? error.message
    : "Typst could not compile this document.";
}

async function saveAs(webContents: WebContents, contents: string) {
  const owner = BrowserWindow.fromWebContents(webContents);
  if (!owner) throw new Error("This window is no longer available");
  const currentFilePath = contextFor(webContents).filePath;
  const result = await dialog.showSaveDialog(owner, {
    defaultPath: currentFilePath ?? "Untitled.blocks",

    filters: [
      {
        name: "Blocks document",
        extensions: ["blocks"],
      },
    ],
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  await writeFile(result.filePath, contents, "utf8");

  contextFor(webContents).filePath = result.filePath;
  owner.setTitle(`${path.basename(result.filePath)} — blocks`);

  return {
    filePath: result.filePath,
  };
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  registerDocumentHandlers();
  installApplicationMenu();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  for (const context of windowContexts.values()) {
    void context.typstLanguageServer.stop();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
