const vscode = require('vscode')
const path = require('node:path')
const { execFile, spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const { promisify } = require('node:util')

const run = promisify(execFile)
const setting = 'dockColors.appIconColor'
const blackSuffix = ' (Black)'
const customPathSetting = 'dockColors.customIconPath'

async function activate(context) {
  if (process.platform !== 'darwin') return

  // appRoot is Contents/Resources/app in the macOS desktop bundle.
  const bundle = path.resolve(vscode.env.appRoot, '../../..')
  const helper = context.asAbsolutePath('set-icon')
  const colors = context.extension.packageJSON.contributes.configuration.properties[setting].enum

  const settings = vscode.workspace.getConfiguration()
  const previousColor = settings.get(setting)
  const previousBlackVariant = previousColor + blackSuffix
  if (!context.globalState.get('iconVariantsMigrated')) {
    if (settings.get('dockColors.iconBackground') === 'Black' && colors.includes(previousBlackVariant)) {
      await settings.update(setting, previousBlackVariant, vscode.ConfigurationTarget.Global)
    }
    await context.globalState.update('iconVariantsMigrated', true)
  }

  function iconArgs(variant) {
    if (variant === 'Custom') {
      return [bundle, variant, vscode.workspace.getConfiguration().get(customPathSetting)]
    }
    if (variant.endsWith(blackSuffix)) {
      return [bundle, variant.slice(0, -blackSuffix.length), '--black-background']
    }
    return [bundle, variant]
  }
  let panel
  let pending = Promise.resolve()

  function applyColor(offerRestart = false) {
    const color = vscode.workspace.getConfiguration().get(setting)
    pending = pending.then(async () => {
      if (vscode.workspace.getConfiguration().get(setting) !== color) return
      const args = iconArgs(color)
      const restoring = color === 'Default' && args.length === 2
      if (restoring && !context.globalState.get('customIcon')) return

      // Record ownership before applying so a restart can still restore the icon.
      if (!restoring) await context.globalState.update('customIcon', true)
      try {
        await run(helper, args)
      } catch (error) {
        vscode.window.showErrorMessage(
          `Dock Colors could not apply ${color}. ${error.stderr?.trim() || error.message}`
        )
        return
      }
      if (restoring) await context.globalState.update('customIcon', false)
      if (offerRestart && vscode.window.state.focused) {
        void vscode.window.showInformationMessage(
          'App icon applied. Restart VS Code to reload its Dock icon.',
          'Restart VS Code'
        ).then(action => {
          if (action !== 'Restart VS Code') return
          return vscode.commands.executeCommand('dockColors.restartVSCode')
        })
      }
    }).catch(error => {
      vscode.window.showErrorMessage(`Dock Colors: ${error.message}`)
    })
  }

  context.subscriptions.push(vscode.commands.registerCommand('dockColors.restartVSCode', async () => {
    await pending
    const child = spawn(helper, [bundle, '--restart'], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe']
    })
    let message = ''
    child.stderr.setEncoding('utf8').on('data', chunk => { message += chunk })
    child.stdout.setEncoding('utf8').once('data', chunk => {
      if (chunk.trim() !== 'ready') return
      void vscode.commands.executeCommand('workbench.action.quit').then(undefined, error => {
        child.kill()
        vscode.window.showErrorMessage(`Dock Colors: ${error.message}`)
      })
    })
    child.on('error', error => vscode.window.showErrorMessage(`Dock Colors: ${error.message}`))
    child.on('close', code => {
      if (code) vscode.window.showErrorMessage(`Dock Colors: ${message.trim() || 'Could not restart VS Code.'}`)
    })
    child.unref()
  }))

  context.subscriptions.push(vscode.commands.registerCommand('dockColors.preview', async () => {
    if (panel) {
      panel.reveal()
      return
    }

    const preview = vscode.window.createWebviewPanel(
      'dockColors.preview', 'App Icon Preview', vscode.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [] }
    )
    panel = preview
    context.subscriptions.push(preview)
    const messages = preview.webview.onDidReceiveMessage(async color => {
      if (!colors.includes(color)) return
      try {
        await vscode.workspace.getConfiguration().update(setting, color, vscode.ConfigurationTarget.Global)
      } catch (error) {
        vscode.window.showErrorMessage(error.message)
      }
    })
    let images
    let renderVersion = 0
    function render() {
      if (!images || panel !== preview) return
      const selected = vscode.workspace.getConfiguration().get(setting)
      const nonce = randomBytes(16).toString('hex')
      preview.webview.html = `<!DOCTYPE html><html lang="en"><head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style nonce="${nonce}">
          body { padding: 24px; }
          header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
          h1 { margin: 0; }
          main { display: flex; flex-wrap: wrap; gap: 12px; }
          button { display: grid; justify-items: center; gap: 8px; padding: 12px;
            min-width: 114px; font: inherit; color: var(--vscode-foreground); background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border); border-radius: 8px; cursor: pointer; }
          button[aria-pressed="true"] { border-color: var(--vscode-focusBorder); }
        </style></head><body><header><h1>App Icon Preview</h1></header><main>
        ${images.map(({ color, png }) => `<button data-color="${color}" aria-pressed="${color === selected}">
          <img src="data:image/png;base64,${png}" width="88" height="88" alt="">${color}</button>`).join('')}
        </main><script nonce="${nonce}">
          const vscode = acquireVsCodeApi()
          document.querySelectorAll('[data-color]').forEach(button => {
            button.addEventListener('click', () => vscode.postMessage(button.dataset.color))
          })
        </script></body></html>`
    }
    async function loadImages() {
      const version = ++renderVersion
      const availableColors = colors.filter(color => color !== 'Custom' ||
        vscode.workspace.getConfiguration().get(customPathSetting))
      try {
        const result = await Promise.all(availableColors.map(async color => {
          try {
            const { stdout } = await run(helper, [...iconArgs(color), '--preview'], {
              maxBuffer: 4 * 1024 * 1024
            })
            return { color, png: Buffer.from(stdout.trim(), 'base64').toString('base64') }
          } catch (error) {
            if (color !== 'Custom') throw error
            vscode.window.showErrorMessage(`Dock Colors: ${error.stderr?.trim() || error.message}`)
            return null
          }
        }))
        if (version !== renderVersion || panel !== preview) return
        images = result.filter(Boolean)
        render()
      } catch (error) {
        if (version !== renderVersion || panel !== preview) return
        preview.dispose()
        vscode.window.showErrorMessage(`Dock Colors: ${error.stderr?.trim() || error.message}`)
      }
    }
    const changes = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(customPathSetting)) void loadImages()
      else if (event.affectsConfiguration(setting)) render()
    })
    preview.onDidDispose(() => {
      panel = undefined
      messages.dispose()
      changes.dispose()
    })
    await loadImages()
  }))

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration(setting) ||
        (event.affectsConfiguration(customPathSetting) &&
          vscode.workspace.getConfiguration().get(setting) === 'Custom')) applyColor(true)
  }))
  applyColor()
}

module.exports = { activate }
