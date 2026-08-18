const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')

function log(level, module, message) {
  const time = new Date().toTimeString().split(' ')[0]
  console.log(`[${time}] [${level}] [${module}] ${message}`)
}

const username = process.argv[2] || 'biru44zika'

const bot = mineflayer.createBot({
  //host: 'localhost',
  host: 'olimpo.craftlandia.com.br',
  username: username,
  auth: 'offline',
  //port: 51744,
})

bot.loadPlugin(pathfinder)

bot.once('spawn', async () => {
  const movements = new Movements(bot)

  movements.allowFreeMotion = true
  movements.canDig = true
  movements.maxDropDown = 13
  movements.allowSprinting = true
  movements.allow1by1towers = false
  movements.allowParkour = false

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
  await bot.waitForTicks(20 * 5)
  bot.chat('/tell BallKnower hello boss')
})

async function goTo(x, y, z) {
  const goal = new goals.GoalBlock(x, y, z)
  await bot.pathfinder.goto(goal)
  log('INFO', 'movement', `arrived at (${x}, ${y}, ${z})`)
}

let lastTree = null;
function locateNearestTree(maxDistance = 32) {
  const block = bot.findBlock({
    maxDistance,
    matching: (b) => {

      return b.name.includes('log') && 
             !(lastTree && b.position.x === lastTree.x && b.position.z === lastTree.z);
    }
  });

  if (!block) return null; 

  let pos = block.position;

  while (bot.blockAt(pos.offset(0, -1, 0))?.name.includes('log')) {
    pos = pos.offset(0, -1, 0);
  }

  lastTree = { x: pos.x, z: pos.z };

  return bot.blockAt(pos);
}

async function breakTree(x, y, z) {
  let currentY = y

  while (true) {
    const block = bot.blockAt(new Vec3(x, currentY, z))

    if (!block || !block.name.includes('log')) {
      log('INFO', 'chop', 'no more logs found, stopping')
      break
    }

    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))

    log('INFO', 'chop', `digging log at y=${currentY}`)
    await bot.dig(block)

    currentY++
  }
}

function logPosition() {
  const pos = bot.entity.position
  log('INFO', 'movement', `x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`)
}

async function interactAt(x, y, z, act, label = 'interact') {
  const block = bot.blockAt(new Vec3(x, y, z))
  if (!block) {
    log('WARN', 'shop', 'no block found at that position')
    return
  }

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  await act(block)
  log('INFO', 'shop', `${label} on ${block.name} at ${block.position}`)
}

async function clickBuy(x, y, z) {
  await interactAt(x, y, z, (block) => bot.activateBlock(block), 'buy click')
}

async function clickSell(x, y, z) {
  await interactAt(x, y, z, (block) => bot.dig(block), 'sell click (dig)')
}

async function warpToShop() {
  bot.chat('/warp loja')
  await bot.waitForTicks(20 * 10)

  bot.chat('/menuloja off')

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
}

async function sell() {
  await warpToShop()
  log('INFO', 'shop', 'checkpoint AMENO reached')

  await goTo(-644, 6, 653)
  log('INFO', 'shop', 'arrived at sell point')

  for (let z = 651; z <= 656; z++) {
    await clickSell(-644, 7, z)
  }

  await bot.waitForTicks(20 * 6)
  log('INFO', 'shop', 'sell complete')
}

async function buyFood() {
  await warpToShop()
  log('INFO', 'shop', 'checkpoint AMENO2 reached')

  await goTo(-662, 6, 605)
  log('INFO', 'shop', 'arrived at food shop')

  bot.setControlState('sneak', true);

  await clickBuy(-663, 7, 605)

  bot.setControlState('sneak', false);

  log('INFO', 'shop', 'food purchase complete')
}

async function chopTree() {
  const tree = locateNearestTree()
  if (!tree) {
    log('WARN', 'chop', 'no tree found')
    return
  }

  await goTo(tree.position.x, tree.position.y, tree.position.z)
  await bot.waitForTicks(13)

  await breakTree(tree.position.x, tree.position.y + 2, tree.position.z)
}

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

    // safety timeout in case server never responds
    setTimeout(() => {
      bot.removeListener('message', listener)
      resolve(balance)
    }, 5000)
  })
}

async function sendChat(cmd, { repeats = 1, ticks = 0 } = {}) {
  for (let i = 0; i < repeats; i++) {
    bot.chat(cmd)
    if (ticks > 0 && i < repeats - 1) await bot.waitForTicks(ticks)
  }
}

async function pay(username, amount){
    await sendChat(`/money pay ${username} ${amount}`, { repeats: 2, ticks: 15 })
}

async function setHome(name=""){
    await sendChat('/sethome ' + name, { repeats: 2, ticks: 13 })
}

async function goHome(name=""){
    bot.chat('/home '+name)
    await bot.waitForTicks(20 * 10)
}

function countItems(bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items()
    .filter(Boolean)
    .filter(item => list.includes(item.name))
    .reduce((total, item) => total + item.count, 0)
}

function findItem(bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items().find(item => item && list.includes(item.name)) || null
}

async function ensure({ measure, threshold, remediate, label }) {
  const value = await measure()
  if (value >= threshold) return

  log('WARN', 'survival', `${label} low: ${value}/${threshold}`)
  if (remediate) await remediate()
}

async function restock() {
  await setHome("tmp")
  await bot.waitForTicks(13)
  await buyFood()
  await goHome("tmp")
}

async function eat() {
  await bot.waitForTicks(20)
  const food = findItem(bot, 'cooked_beef')
  await bot.equip(food, 'hand')
  await bot.consume()
  await bot.waitForTicks(20)
  const axe = findItem(bot, 'diamond_axe')
  await bot.waitForTicks(20)
  await bot.equip(axe, 'hand')
}

async function ensureFood() {
  await ensure({ measure: () => countItems(bot, 'cooked_beef'), threshold: 1, label: 'meat', remediate: restock })
  await ensure({ measure: () => bot.food, threshold: 15, label: 'food', remediate: eat })
}

async function ensureAxe() {
  await ensure({ measure: () => countItems(bot, 'diamond_axe'), threshold: 1, label: 'axes' })
}

async function chopLoop(times) {
  let ok = true
  for (let i = 0; i < times; i++) {
    await ensureFood()
    await ensureAxe()
    ok = (await runAction('chop tree', () => chopTree(), { retry: 1, module: 'chop' })) && ok

    log('INFO', 'progress', `${i + 1}/${times}`)
  }
  if (!ok) throw new Error('chop failed after retries')
}

async function runAction(name, fn, { retry = 0, module = 'command' } = {}) {
  log('INFO', module, `start: ${name}`)
  try {
    await fn()
    log('INFO', module, `done: ${name}`)
    return true
  } catch (err) {
    if (retry > 0) {
      log('WARN', module, `retrying ${name}: ${err.message}`)
      return runAction(name, fn, { retry: retry - 1, module })
    }
    log('ERROR', module, `failed: ${name} - ${err.message}`)
    return false
  }
}

async function runSequence(username, msg) {
  const commands = msg.split(';').map(c => c.trim()).filter(Boolean)

  for (const cmd of commands) {
    await runAction(cmd, () => runCommand(username, cmd))
  }
}

const commands = {
  '@call': {
    run: (username) => bot.chat(`/call ${username}`)
  },

  '@treebreak': {
    parse: (msg) => msg.replace('@treebreak', '').trim().split(/\s+/).slice(0, 3).map(parseFloat),
    run: (username, [x, y, z]) => breakTree(x, y, z)
  },

  '@chat': {
    parse: (msg) => msg.replace(/^@chat\s+/, ''),
    run: (username, text) => bot.chat(text)
  },

  '@findtree': {
    run: () => {
      const tree = locateNearestTree()
      log('INFO', 'chop', tree ? `nearest tree at ${tree.position}` : 'no tree found')
    }
  },

  '@goto': {
    parse: (msg) => msg.replace('@goto', '').trim().split(/\s+/).slice(0, 3).map(parseInt),
    run: (username, [x, y, z]) => goTo(x, y, z)
  },

  '@position': {
    run: () => logPosition()
  },

  '@pay': {
    parse: (msg) => msg.replace('@pay ', ''),
    run: (username, amount) => pay(username, amount)
  },

  '@wait': {
    parse: (msg) => msg.replace('@wait ', ''),
    run: (username, ticks) => bot.waitForTicks(ticks)
  },

  '@sethome': {
    run: () => setHome()
  },

  '@gohome': {
    run: () => goHome()
  },

  '@chop': {
    parse: (msg) => parseInt(msg.replace('@chop', '').trim().split(/\s+/)[0]) || 1,
    run: (username, times) => chopLoop(times)
  },

  '@sell': {
    run: () => sell()
  },

  '@buyfood': {
    run: () => buyFood()
  },

  '@balance': {
    run: async () => {
      const bal = await getBalance()
      log('INFO', 'economy', `current balance: ${bal}`)
    }
  }
}

async function runCommand(username, msg) {
  const token = (msg.match(/^(@\w+)/) || [])[0]
  const entry = commands[token]
  if (!entry) throw new Error(`unknown command: ${msg}`)

  const parse = entry.parse || (() => [])
  const args = parse(msg)
  await entry.run(username, args)
}

bot.on('message', async (jsonMsg) => {
  const textMsg = jsonMsg.toString()
  const match = textMsg.match(/^\(Mensagem de (\w+)\): (.+)$/)
  if (match) {
    const [, senderUsername, msg] = match
    log('INFO', 'whisper', `${senderUsername}: ${msg}`)

    await runSequence(senderUsername, msg)

    return
  }
})

process.stdin.on('data', async (data) => {
  const msg = data.toString().trim()
  if (!msg) return

  log('INFO', 'stdin', msg)

  await runSequence('orchestrator', msg)
})

bot.on('kicked', (reason) => log('ERROR', 'connection', reason))
bot.on('error', (err) => log('ERROR', 'connection', err.message))