require('dotenv').config({ path: '../../.env' })
import 'isomorphic-fetch'
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import path, { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import crypto from 'crypto'
import axios from 'axios'

const SERVER_ENDPOINT = process.env.SERVER_ENDPOINT ?? 'http://localhost:8080'
const CALLBACK_DEEPLINK =
  process.env.CALLBACK_DEEPLINK ?? 'mavis-sso://oauth2/callback'
const SSO_ENDPOINT =
  process.env.SSO_ENDPOINT || 'https://api-gateway.skymavis.one'
const CLIENT_ID = process.env.CLIENT_ID ?? ''

const gotTheLock = app.requestSingleInstanceLock()

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('mavis-sso', process.execPath, [
      path.resolve(process.argv[1]),
    ])
  }
} else {
  app.setAsDefaultProtocolClient('mavis-sso')
}

let mainWindow

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    // the commandLine is array of strings in which last element is deep link url
    // the url str ends with /
    const url = commandLine?.pop()?.slice(0, -1) ?? ''
    if (url.startsWith(CALLBACK_DEEPLINK)) {
      urlResolve(url)
    }
  })
}

let urlResolve: (query: string) => void

const urlPromise = new Promise<string>(resolve => (urlResolve = resolve))

app.on('open-url', (_, url) => {
  if (url.startsWith(CALLBACK_DEEPLINK)) {
    urlResolve(url)
  }
})

ipcMain.handle('request_login', async () => {
  const query = new URLSearchParams({
    state: crypto.randomUUID(),
    client_id: CLIENT_ID,
    response_type: 'code',
    scopes: 'openid',
    remember: 'false',
    redirect_uri: CALLBACK_DEEPLINK,
  })

  shell.openExternal(`${SSO_ENDPOINT}/oauth2/auth?${query.toString()}`)

  try {
    const callbackUrl = await urlPromise
    const code = new URL(callbackUrl).searchParams.get('code')

    if (!code) {
      dialog.showErrorBox('Error', 'Code not found!')

      return {
        token: null,
      }
    }

    const { data } = await axios({
      baseURL: SERVER_ENDPOINT,
      url: '/oauth2/authorization-code/token',
      method: 'POST',
      data: {
        code,
        redirect_url: 'mavis-sso://oauth2/callback',
      },
    })

    return {
      token: data,
    }
  } catch {
    dialog.showErrorBox('Error', 'Something went wrong!')

    return {
      token: null,
    }
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.