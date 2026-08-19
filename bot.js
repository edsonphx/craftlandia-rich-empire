const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')

function log(level, module, message) {
  const time = new Date().toTimeString().split(' ')[0]
  console.log(`[${time}] [${level}] [${module}] ${message}`)
}

const username = process.argv[2] || 'biru44zika'
const viewerPort = parseInt(process.argv[3]) || null

function countItems(name) {
  return bot.inventory.items()
    .filter(item => item && item.name === name)
    .reduce((total, item) => total + item.count, 0)
}

function findItem(name) {
  return bot.inventory.items().find(item => item && item.name === name) || null
}

async function sendChat(cmd, { repeats = 1, ticks = 0 } = {}) {
  for (let i = 0; i < repeats; i++) {
    bot.chat(cmd)
    if (ticks > 0 && i < repeats - 1) await bot.waitForTicks(ticks)
  }
}

const bot = mineflayer.createBot({
  host: process.env.BOT_HOST || 'olimpo.clmc.com.br',
  username: username,
  auth: 'offline',
  port: parseInt(process.env.BOT_PORT) || 3737,
})

bot.loadPlugin(pathfinder)

bot.once('spawn', async () => {
  if (viewerPort) {
    mineflayerViewer(bot, { port: viewerPort, firstPerson: true, viewDistance: 6 })
    log('INFO', 'viewer', `listening on port ${viewerPort}`)
  }

  const movements = new Movements(bot)

  movements.allowFreeMotion = false
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
  await bot.waitForTicks(33 * 6)
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
      if (!b.name.includes('log')) return false;
      if (lastTree && b.position.x === lastTree.x && b.position.z === lastTree.z) return false;

      const above = bot.blockAt(b.position.offset(0, 1, 0));
      const below = bot.blockAt(b.position.offset(0, -1, 0));
      return above?.name.includes('log') || below?.name.includes('log');
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

async function interactAt(x, y, z, act, label) {
  const block = bot.blockAt(new Vec3(x, y, z))
  if (!block) {
    log('WARN', 'shop', 'no block found at that position')
    return
  }

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  await act(block)
  log('INFO', 'shop', `${label} on ${block.name} at ${block.position}`)
}

function clickBuy(x, y, z) {
  return interactAt(x, y, z, (block) => bot.activateBlock(block), 'buy click')
}

function clickSell(x, y, z) {
  return interactAt(x, y, z, (block) => bot.dig(block), 'sell click (dig)')
}

async function sneakBuy(x, y, z) {
  bot.setControlState('sneak', true)
  await clickBuy(x, y, z)
  bot.setControlState('sneak', false)
}

async function warpToShop() {
  bot.chat('/warp loja')
  await bot.waitForTicks(20 * 10)
  bot.chat('/menuloja off')
}

async function sell() {
  await warpToShop()

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
  log('INFO', 'shop', 'checkpoint AMENO reached')

  await goTo(-644, 6, 653)
  log('INFO', 'shop', 'arrived at sell point')

  for (let z = 651; z <= 656; z++) {
    await clickSell(-644, 7, z)
  }

  await bot.waitForTicks(20 * 6)
  log('INFO', 'shop', 'sell complete')
}

async function buyDiamond() {
  await warpToShop()

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
  await goTo(-700, 6, 639)
  await goTo(-703, 6, 627)
  log('INFO', 'shop', 'checkpoint AMENO3 reached')

  await goTo(-700, 6, 607)
  log('INFO', 'shop', 'arrived at diamond shop')

  await sneakBuy(-700, 7, 605)

  log('INFO', 'shop', 'diamond purchase complete')
}

async function buyFood() {
  await warpToShop()

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
  log('INFO', 'shop', 'checkpoint AMENO2 reached')

  await goTo(-662, 6, 605)
  log('INFO', 'shop', 'arrived at food shop')

  await sneakBuy(-663, 7, 605)

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

async function pay(username, amount){
    await sendChat(`/money pay ${username} ${amount}`, { repeats: 2, ticks: 15 })
    log('INFO', 'economy', `paid ${amount} to ${username}`)
}

async function setHome(name=""){
    await sendChat('/sethome '+name, { repeats: 2, ticks: 13 })
    log('INFO', 'home', name ? `home set: ${name}` : 'home set')
}

async function goHome(name=""){
    log('INFO', 'home', `warping home${name ? ': ' + name : ''}`)
    bot.chat('/home '+name)
    await bot.waitForTicks(20 * 13)
    log('INFO', 'home', 'home reached')
}

async function eat() {
  const food = findItem('cooked_beef')

  if (!food) {
    log('WARN', 'survival', 'no cooked_beef to eat')
    return
  }

  await bot.waitForTicks(20)
  await bot.equip(food, 'hand')
  await bot.consume()
  log('INFO', 'survival', `ate ${food.count} cooked_beef`)
  await bot.waitForTicks(20)
  const axe = findItem('diamond_axe')
  await bot.waitForTicks(20)
  if (axe) await bot.equip(axe, 'hand')
}

async function restock(shopFn) {
  await setHome()
  await bot.waitForTicks(13)
  await shopFn()
  await goHome()
}

async function ensureDiamondstock() {
  await bot.waitForTicks(20)
  const diamondCount = countItems('diamond')

  if (diamondCount < 1) {
    log('WARN', 'diamonds', `diamonds count low: ${diamondCount}`)
    await restock(buyDiamond)
  }
}

async function ensureFoodStock() {
  const meatCount = countItems('cooked_beef')

  if (meatCount < 1) {
    log('WARN', 'survival', `meat count low: ${meatCount}`)
    await restock(buyFood)
  }
}

async function ensureFed() {
  if (bot.food < 15) {
    log('WARN', 'survival', `food low: ${bot.food}`)
    await eat()
  }
}

async function checkAxeSupply() {
  const axeCount = countItems('diamond_axe')

  if (axeCount < 1) {
    log('WARN', 'inventory', `not enough axes: ${axeCount}/1`)
    await craftAxe()
  }
}

async function chopWithRetry() {
  try {
    await chopTree()
  } catch (error) {
    log('WARN', 'chop', 'retrying chop after failure')
    await chopTree()
  }
}

async function chopLoop(times) {
  for (let i = 0; i < times; i++) {
    await ensureFoodStock()
    await ensureFed()
    await checkAxeSupply()
    await chopWithRetry()

    log('INFO', 'progress', `${i + 1}/${times}`)
  }
}

async function craftAxe() {
  await bot.waitForTicks(20)

  const logs = bot.inventory.items().filter(item => item.name.includes('log'))
  let logCount = countLogs(logs)

  if (logCount < 2) {
    log('WARN', 'craft', `not enough logs for axe: ${logCount}/2`)
    await chopTree()
    await bot.waitForTicks(20)
    logs.length = 0
    logs.push(...bot.inventory.items().filter(item => item.name.includes('log')))
    logCount = countLogs(logs)
    log('INFO', 'craft', `logs after chop: ${logCount}`)
  }

  log('INFO', 'craft', 'log OK')
  await ensureDiamondstock()

  try {
    const logItem = logs.find(Boolean)
    if (!logItem) throw new Error('no logs available to craft axe')

    log('INFO', 'craft', `using log type: ${logItem.name}`)

    const plankName = logItem.name.replace('log', 'planks')
    const plankId = bot.registry.itemsByName[plankName].id
    await bot.craft(bot.recipesFor(plankId, null, 1, null)[0], 2, null)
    log('INFO', 'craft', 'planks crafted')

    await bot.waitForTicks(10) // delay to prevent desync

    const tableId = bot.registry.itemsByName['crafting_table'].id
    await bot.craft(bot.recipesFor(tableId, null, 1, null)[0], 1, null)
    log('INFO', 'craft', 'crafting table crafted')

    await bot.waitForTicks(10)

    const stickId = bot.registry.itemsByName['stick'].id
    await bot.craft(bot.recipesFor(stickId, null, 1, null)[0], 1, null)
    log('INFO', 'craft', 'stick crafted')

    await bot.waitForTicks(10)

    const tableItem = findItem('crafting_table')
    await bot.equip(tableItem, 'hand')

    await bot.waitForTicks(10)

    let refBlock = null
    const offsets = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]

    for (const [dx, dy, dz] of offsets) {
      const pos = bot.entity.position.floored().offset(dx, dy, dz)
      const above = bot.blockAt(pos)
      const below = bot.blockAt(pos.offset(0, -1, 0))

      if (above?.name === 'air' && below?.name !== 'air') {
        refBlock = below
        break
      }
    }

    if (!refBlock) {
      log('WARN', 'craft', 'no space to place workbench')
      return
    }

    await bot.placeBlock(refBlock, new Vec3(0, 1, 0))
    log('INFO', 'craft', 'workbench placed')

    await bot.waitForTicks(10)

    const tableBlock = bot.findBlock({
      matching: bot.registry.blocksByName['crafting_table'].id,
      maxDistance: 5
    })

    const axeId = bot.registry.itemsByName['diamond_axe'].id
    const recipe = bot.recipesFor(axeId, null, 1, tableBlock)[0]

    await bot.craft(recipe, 1, tableBlock)

    log('INFO', 'craft', 'diamond axe crafted')
  } catch (err) {
    log('ERROR', 'craft', `crafting failed: ${err.message}`)
    throw err
  }
}

function countLogs(logs) {
  return logs.reduce((total, item) => total + item.count, 0)
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

async function runCommand(username, msg) {
  const tokens = (cmd, n) => msg.replace(cmd, '').trim().split(/\s+/).slice(0, n)

  if (msg.includes('@call')) {
    bot.chat(`/call ${username}`)
  }

  if (msg.includes('@treebreak')) {
    const [x, y, z] = tokens('@treebreak', 3).map(parseFloat)
    await breakTree(x, y, z)
  }

  if (msg.includes('@chat')) {
    bot.chat(msg.replace('@chat ', ''))
  }

  if (msg.includes('@findtree')) {
    const tree = locateNearestTree()
    log('INFO', 'chop', tree ? `nearest tree at ${tree.position}` : 'no tree found')
  }

  if (msg.includes('@goto')) {
    const [x, y, z] = tokens('@goto', 3).map(v => parseInt(v))
    await goTo(x, y, z)
  }

  if (msg.includes('@position')) {
    logPosition()
  }

  if (msg.includes('@pay')) {
    await pay(username, tokens('@pay', 1)[0])
  }

  if (msg.includes('@wait')) {
    await bot.waitForTicks(tokens('@wait', 1)[0])
  }

  if (msg.includes('@sethome')) {
    await setHome()
  }

  if (msg.includes('@gohome')) {
    await goHome()
  }

  if (msg.includes('@chop')) {
    await chopLoop(parseInt(tokens('@chop', 1)[0]) || 1)
  }

  if (msg.includes('@sell')) {
    await sell()
  }

  if (msg.includes('@buyfood')) {
    await buyFood()
  }

  if (msg.includes('@buydiamond')) {
    await buyDiamond()
  }

  if (msg.includes('@balance')) {
    const bal = await getBalance()
    log('INFO', 'economy', `current balance: ${bal}`)
  }

  if (msg.includes('@craftaxe')) {
    await craftAxe()
  }
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