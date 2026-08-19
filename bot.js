const fs = require('fs')
const path = require('path')
const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')
const { SocksClient } = require('socks')
const helpers = require('./helpers')

const { log } = helpers

const username = process.argv[2] || 'biru44zika'
const viewerPort = parseInt(process.argv[3]) || null
const proxyArg = process.argv[4] || null // format: "host:port" or "host:port:user:pass"

const MC_HOST = process.env.BOT_HOST || 'olimpo.clmc.com.br'
const MC_PORT = parseInt(process.env.BOT_PORT) || 3737

const botOptions = {
  host: MC_HOST,
  username: username,
  auth: 'offline',
  port: MC_PORT,
}

if (proxyArg) {
  const [proxyHost, proxyPort, proxyUser, proxyPass] = proxyArg.split(':')

  botOptions.connect = (client) => {
    SocksClient.createConnection({
      proxy: {
        host: proxyHost,
        port: parseInt(proxyPort),
        type: 5,
        userId: proxyUser,
        password: proxyPass
      },
      command: 'connect',
      destination: { host: MC_HOST, port: MC_PORT }
    }).then(({ socket }) => {
      client.setSocket(socket)
      client.emit('connect')
    }).catch(err => {
      log('ERROR', 'proxy', `connection failed: ${err.message}`)
    })
  }

  log('INFO', 'proxy', `routing through ${proxyHost}:${proxyPort}`)
}

const bot = mineflayer.createBot(botOptions)

bot.loadPlugin(pathfinder)

let botReady = false
async function waitUntilReady() {
  while (!botReady) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

bot.once('spawn', async () => {
  if (viewerPort) {
    mineflayerViewer(bot, { port: viewerPort, firstPerson: true, viewDistance: 6 })
    log('INFO', 'viewer', `listening on port ${viewerPort}`)
  }

  const movements = new Movements(bot)

  movements.allowFreeMotion = true
  movements.canDig = true
  movements.maxDropDown = 13
  movements.allowSprinting = true
  movements.allow1by1towers = false
  movements.allowParkour = false
  movements.allowCornerCutting = false // stops bot getting hitbox-snagged on corners

  for (const block of Object.values(bot.registry.blocksByName)) {
    if (block.name.includes('leaves')) {
        movements.blocksToAvoid.add(block.id)
    }
  }

  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 13000

  await bot.waitForTicks(20 * 5) // espera 5 segundos (20 ticks/s)
  bot.chat('/register ball1234')
  bot.chat('/login ball1234')
  log('INFO', 'auth', 'logged in')
  await bot.waitForTicks(13)
  bot.chat('/menuloja off')
  await bot.waitForTicks(33 * 6)
  bot.chat('/tell BallKnower hello boss')

  botReady = true
  log('INFO', 'auth', 'bot ready for commands')
})

// --- command registry (auto-discovered from commands/*.js) ---

const ctx = { bot, helpers, log, username }

const commands = {}
for (const file of fs.readdirSync(path.join(__dirname, 'commands'))) {
  if (!file.endsWith('.js')) continue
  commands[file.slice(0, -3)] = require(path.join(__dirname, 'commands', file))
}

async function runCommand(username, msg) {
  for (const [name, run] of Object.entries(commands)) {
    if (msg.includes('@' + name)) {
      await run(ctx, msg)
      return
    }
  }

  if (msg.includes('@balance')) {
    const bal = await getBalance()
    log('INFO', 'economy', `current balance: ${bal}`)
  }
}

async function runSequence(username, msg) {
  const commands = msg.split(';').map(c => c.trim()).filter(Boolean)

  for (const cmd of commands) {
    log('INFO', 'command', `start: ${cmd}`)
    try {
      await runCommand(username, cmd)
      log('INFO', 'command', `done: ${cmd}`)
    } catch (err) {
      log('ERROR', 'command', `failed: ${cmd} - ${err.message}`)
    }
  }
}

// --- @balance (stays in bot.js: stateful message-listener promise) ---

let balance = null

function getBalance() {
  return new Promise((resolve) => {
    const listener = (jsonMsg) => {
      const text = jsonMsg.toString()
      const match = text.match(/Seu saldo atual: ([\d.,]+) Coins/)

      if (match) {
        balance = parseFloat(match[1].replace(',', ''))
        bot.removeListener('message', listener)
        resolve(balance)
      }
    }

    bot.on('message', listener)
    bot.chat('/money')

    setTimeout(() => {
      bot.removeListener('message', listener)
      resolve(balance)
    }, 5000)
  })
}

bot.on('message', async (jsonMsg) => {
  const textMsg = jsonMsg.toString()
  const match = textMsg.match(/^\(Mensagem de (\w+)\): (.+)$/)
  if (match) {
    const [, senderUsername, msg] = match
    log('INFO', 'whisper', `${senderUsername}: ${msg}`)

    await waitUntilReady()
    await runSequence(senderUsername, msg)

    return
  }
})

process.stdin.on('data', async (data) => {
  const msg = data.toString().trim()
  if (!msg) return

  log('INFO', 'stdin', msg)

  await waitUntilReady()
  await runSequence('orchestrator', msg)
})

bot.on('kicked', (reason) => log('ERROR', 'connection', reason))
bot.on('error', (err) => log('ERROR', 'connection', err.message))