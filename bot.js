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

const bot = mineflayer.createBot({
  //host: 'localhost',
  host: 'olimpo.craftlandia.com.br',
  username: username,
  auth: 'offline',
  //port: 51744,
})

bot.loadPlugin(pathfinder)

// anti-flood: o servidor recusa comandos seguidos ("Aguarde 5 segundos" / "Cannot send chat message").
// toda mensagem passa por uma fila com intervalo minimo; bot.chat retorna uma promise que resolve quando enviou
// (instalado no 'login' porque os plugins do mineflayer, incluindo bot.chat, so sao injetados depois do createBot)
const CHAT_GAP_MS = 5500
bot.once('login', () => {
  const rawChat = bot.chat.bind(bot)
  let chatQueue = Promise.resolve()
  let lastChatAt = 0
  bot.chat = (message) => {
    chatQueue = chatQueue.then(async () => {
      const wait = lastChatAt + CHAT_GAP_MS - Date.now()
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
      rawChat(message)
      lastChatAt = Date.now()
    })
    return chatQueue
  }
})

// o servidor segura o jogador num limbo de login e nao manda update_health
// ate autenticar, entao o 'spawn' do mineflayer so dispara depois do /login.
// por isso o login roda no evento 'login', com setTimeout (sem ticks de fisica ainda)
bot.once('login', async () => {
  await new Promise(resolve => setTimeout(resolve, 5000))
  await bot.chat('/register ball1234')
  await bot.chat('/login ball1234')
  log('INFO', 'auth', 'logged in')
})

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
  movements.allowCornerCutting = false

  for (const block of Object.values(bot.registry.blocksByName)) {
    if (block.name.includes('leaves')) {
        movements.blocksToAvoid.add(block.id)
    }
  }

  bot.pathfinder.setMovements(movements)
  bot.pathfinder.thinkTimeout = 13000

  log('INFO', 'auth', 'spawned')
  await bot.waitForTicks(13)
  await bot.chat('/menuloja off')
  await bot.waitForTicks(33 * 6)
  await bot.chat('/tell BallKnower hello boss')
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

async function buy(x, y, z) {
  const block = bot.blockAt(new Vec3(x, y, z))
  if (!block) {
    log('WARN', 'shop', 'no block found at that position')
    return
  }

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  await bot.activateBlock(block)
  log('INFO', 'shop', `buy click on ${block.name} at ${block.position}`)
}

async function clickSell(x, y, z) {
  const block = bot.blockAt(new Vec3(x, y, z))
  if (!block) {
    log('WARN', 'shop', 'no block found at that position')
    return
  }

  log('INFO', 'shop', `sign at ${block.position}: ${signText(block)}`)
  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  await bot.dig(block)
  log('INFO', 'shop', `sell click (dig) on ${block.name} at ${block.position}`)
}

function signText(block) {
  const text = typeof block.getSignText === 'function' ? block.getSignText()[0] : block.signText
  return text ? text.replace(/§./g, '').split('\n').map(l => l.trim()).join(' | ') : '(no text)'
}

function logNearbySigns(maxDistance = 8) {
  const signs = bot.findBlocks({ matching: b => b.name.includes('sign'), maxDistance, count: 50 })
  if (!signs.length) log('INFO', 'shop', 'no signs nearby')
  for (const pos of signs) {
    const around = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
      .map(([dx, dy, dz]) => bot.blockAt(pos.offset(dx, dy, dz)))
      .filter(b => b && b.name !== 'air' && !b.name.includes('sign'))
      .map(b => `${b.name}${b.metadata ? ':' + b.metadata : ''}@${b.position.x - pos.x},${b.position.y - pos.y},${b.position.z - pos.z}`)
    log('INFO', 'shop', `sign at ${pos}: ${signText(bot.blockAt(pos))}  [around: ${around.join(' ')}]`)
  }

  // o item vendido em cada placa costuma ficar num item frame do lado
  for (const e of Object.values(bot.entities)) {
    if (e.name !== 'item_frame' || e.position.distanceTo(bot.entity.position) > maxDistance) continue
    const slot = e.metadata?.find(m => m && typeof m === 'object' && ('itemId' in m || 'blockId' in m))
    const id = slot?.itemId ?? slot?.blockId
    const item = id !== undefined ? bot.registry.items[id] : null
    log('INFO', 'shop', `item frame at ${e.position.floored()}: ${item ? item.name : 'empty'}${slot?.itemDamage ? ':' + slot.itemDamage : ''}`)
  }
}

async function sell() {
  await bot.chat('/warp loja')
  await bot.waitForTicks(20 * 10)

  await bot.chat('/menuloja off')

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
  log('INFO', 'shop', 'checkpoint AMENO reached')

  await goTo(-644, 6, 653)
  log('INFO', 'shop', 'arrived at sell point')

  await clickSell(-644, 7, 651)
  await clickSell(-644, 7, 652)
  await clickSell(-644, 7, 653)
  await clickSell(-644, 7, 654)
  await clickSell(-644, 7, 655)
  await clickSell(-644, 7, 656)

  await bot.waitForTicks(20 * 6)
  log('INFO', 'shop', 'sell complete')
}

async function buyDiamond() {
  await bot.chat('/warp loja')
  await bot.waitForTicks(20 * 10)

  await bot.chat('/menuloja off')

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
  await goTo(-700, 6, 639)
  await goTo(-703, 6, 627)
  log('INFO', 'shop', 'checkpoint AMENO3 reached')

  await goTo(-700, 6, 607)
  log('INFO', 'shop', 'arrived at diamond shop')

  bot.setControlState('sneak', true);

  await buy(-700, 7, 605)

  bot.setControlState('sneak', false);

  log('INFO', 'shop', 'diamond purchase complete')
}

async function buyFood() {
  await bot.chat('/warp loja')
  await bot.waitForTicks(20 * 10)

  await bot.chat('/menuloja off')

  await goTo(-677, 6, 728)
  await goTo(-677, 6, 663)
  log('INFO', 'shop', 'checkpoint AMENO2 reached')

  await goTo(-662, 6, 605)
  log('INFO', 'shop', 'arrived at food shop')

  bot.setControlState('sneak', true);

  await buy(-663, 7, 605)

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
      const match = text.match(/Seu saldo atual: ([\d.,]+) Coins?/)

      if (match) {
        balance = parseFloat(match[1].replace(',', ''))
        bot.removeListener('message', listener)
        resolve(balance)
      }
    }

    bot.on('message', listener)

    // safety timeout in case server never responds (conta a partir do envio, nao da fila)
    bot.chat('/money').then(() => setTimeout(() => {
      bot.removeListener('message', listener)
      resolve(balance)
    }, 5000))
  })
}

async function pay(username, amount){
    await bot.chat(`/money pay ${username} ${amount}`)
    await bot.waitForTicks(15)
    await bot.chat(`/money pay ${username} ${amount}`)
}

async function setHome(name=""){
    await bot.chat('/sethome '+name)
    await bot.waitForTicks(13)
    await bot.chat('/sethome '+name)
}

async function goHome(name=""){
    var command = '/home '+name
    console.log("INFO", "command: "+command)
    await bot.chat(command)
    await bot.waitForTicks(20 * 13)
}

async function eat() {
  const food = bot.inventory.items().find(item => item.name === 'cooked_beef');

    if (!food) {
        log('WARN', 'survival', 'no cooked_beef to eat')
        return;
    }

    await bot.waitForTicks(20)
    await bot.equip(food, 'hand');
    await bot.consume(); 
    await bot.waitForTicks(20)
    const axe = findAxe();
    if (!axe) return;
    await bot.waitForTicks(20)
    await bot.equip(axe, 'hand');
}

// prefere machado de diamante, mas aceita qualquer machado (ex: iron_axe do Kit Basico)
function findAxe() {
  const items = bot.inventory.items()
  return items.find(item => item.name === 'diamond_axe') || items.find(item => item.name.endsWith('_axe'))
}

async function ensureDiamondstock() {
  await bot.waitForTicks(20)
  const diamondCount = bot.inventory.items()
    .filter(item => item.name === 'diamond')
    .reduce((total, item) => total + item.count, 0)

  if (diamondCount < 1) {
    log('WARN', 'diamonds', `diamonds count low: ${diamondCount}`)
    await setHome()
    await bot.waitForTicks(13)
    await buyDiamond()
    await goHome()
  }
}

async function ensureFoodStock() {
  const meatCount = bot.inventory.items()
    .filter(item => item.name === 'cooked_beef')
    .reduce((total, item) => total + item.count, 0)

  if (meatCount < 1) {
    log('WARN', 'survival', `meat count low: ${meatCount}`)
    await setHome()
    await bot.waitForTicks(13)
    await buyFood()
    await goHome()
  }
}

async function ensureFed() {
  if (bot.food < 15) {
    log('WARN', 'survival', `food low: ${bot.food}`)
    await eat()
  }
}

async function checkAxeSupply() {
  if (!findAxe()) {
    log('WARN', 'inventory', 'not enough axes: 0/1')
    await craftAxe()
  }

  const axe = findAxe()
  if (axe && bot.heldItem?.name !== axe.name) {
    await bot.equip(axe, 'hand')
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

  var logs = bot.inventory.items().filter(item => item.name.includes('log'));
  var logCount = logs.reduce((total, item) => total + item.count, 0);

  if (logCount < 2) {
    await chopTree();
    await bot.waitForTicks(20)
    logs = bot.inventory.items().filter(item => item.name.includes('log'));
  }

  console.log("INFO", "log OK")
  await ensureDiamondstock()

  try {
    log('INFO', 'craft', `using log type: ${logs[0]?.name}`)

    // versoes novas: oak_log -> oak_planks. na 1.8 e um item so ('planks', tipo no metadata) e o
    // dark oak vem como 'log2', que viraria 'planks2' (nao existe). recipesFor escolhe a receita
    // que bate com a madeira do inventario
    var plankName = logs[0].name.replace('log', 'planks');
    var plankItem = bot.registry.itemsByName[plankName] || bot.registry.itemsByName['planks'];
    var plankId = plankItem.id;
    await bot.craft(bot.recipesFor(plankId, null, 1, null)[0], 2, null);

    await bot.waitForTicks(10); // delay to prevent desync

    var tableId = bot.registry.itemsByName['crafting_table'].id;
    await bot.craft(bot.recipesFor(tableId, null, 1, null)[0], 1, null);

    await bot.waitForTicks(10);

    var stickId = bot.registry.itemsByName['stick'].id;
    await bot.craft(bot.recipesFor(stickId, null, 1, null)[0], 1, null);

    await bot.waitForTicks(10);

    const tableItem = bot.inventory.items().find(item => item.name === 'crafting_table');
    await bot.equip(tableItem, 'hand');

    await bot.waitForTicks(10);

    let refBlock = null;
    const offsets = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

    for (const [dx, dy, dz] of offsets) {
      const pos = bot.entity.position.floored().offset(dx, dy, dz);
      const above = bot.blockAt(pos);
      const below = bot.blockAt(pos.offset(0, -1, 0));

      if (above?.name === 'air' && below?.name !== 'air') {
        refBlock = below;
        break;
      }
    }

    if (!refBlock) {
      log('WARN', 'craft', 'no space to place workbench')
      return;
    }

    await bot.placeBlock(refBlock, new Vec3(0, 1, 0));

    await bot.waitForTicks(10);

    const tableBlock = bot.findBlock({
      matching: bot.registry.blocksByName['crafting_table'].id,
      maxDistance: 5
    });

    const axeId = bot.registry.itemsByName['diamond_axe'].id;
    const recipe = bot.recipesFor(axeId, null, 1, tableBlock)[0];

    await bot.craft(recipe, 1, tableBlock);

    log('INFO', 'craft', 'diamond axe crafted')

  } catch (err) {
    log('ERROR', 'craft', `crafting failed: ${err.message}`)
    throw err
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

// comandos extras ficam em commands.js, que e relido a cada comando:
// da pra criar/editar comandos sem reiniciar o bot
function loadExtraCommands() {
  const file = require.resolve('./commands.js')
  delete require.cache[file]
  try {
    return require(file)
  } catch (err) {
    log('ERROR', 'command', `commands.js failed to load: ${err.message}`)
    return {}
  }
}

async function runCommand(username, msg) {
  const extra = loadExtraCommands()
  for (const [name, fn] of Object.entries(extra)) {
    if (msg.split(/\s+/)[0] === name) {
      const args = msg.split(/\s+/).slice(1)
      const ctx = {
        bot, log, username, Vec3, goals,
        goTo, breakTree, locateNearestTree, chopTree, chopLoop, buy, clickSell, sell, buyFood, buyDiamond,
        getBalance, pay, setHome, goHome, eat, findAxe, craftAxe, logPosition, logNearbySigns, renderMap
      }
      await fn(ctx, args)
      return
    }
  }

  if (msg.includes('@call')) {
    await bot.chat(`/call ${username}`)
  }

  if (msg.includes('@treebreak')) {
    var args = msg.replace('@treebreak', '').trim().split(/\s+/)
    var x = parseFloat(args[0])
    var y = parseFloat(args[1])
    var z = parseFloat(args[2])
    await breakTree(x, y, z)
  }

  if (msg.includes('@chat')) {
    await bot.chat(msg.replace('@chat ', ''))
  }

  if (msg.includes('@findtree')) {
    const tree = locateNearestTree()
    log('INFO', 'chop', tree ? `nearest tree at ${tree.position}` : 'no tree found')
  }

  if (msg.includes('@goto')) {
    var args = msg.replace('@goto', '').trim().split(/\s+/)
    var x = parseInt(args[0])
    var y = parseInt(args[1])
    var z = parseInt(args[2])
    await goTo(x, y, z)
  }

  if (msg.includes('@position')) {
    logPosition()
  }

  if (msg.includes('@pay')) {
    var amount = msg.replace('@pay ', '')
    await pay(username, amount)
  }

  if (msg.includes('@wait')) {
    var ticks = msg.replace('@wait ', '')
    await bot.waitForTicks(ticks)
  }

  if (msg.includes('@sethome')) {
    await setHome()
  }

  if (msg.includes('@gohome')) {
    await goHome()
  }

  if (msg.includes('@chop')) {
    var args = msg.replace('@chop', '').trim().split(/\s+/)
    var times = parseInt(args[0]) || 1
    await chopLoop(times)
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

  if (msg.includes('@signs')) {
    logNearbySigns()
  }

  if (msg.includes('@inventory')) {
    const items = bot.inventory.items().map(item => `${item.name}x${item.count}`)
    log('INFO', 'inventory', items.length ? items.join(', ') : 'empty')
  }

  if (msg.includes('@click')) {
    var args = msg.replace('@click', '').trim().split(/\s+/)
    var slot = parseInt(args[0])
    var button = parseInt(args[1]) || 0 // 0 = esquerdo, 1 = direito
    await bot.clickWindow(slot, button, 0)
    log('INFO', 'window', `clicked slot ${slot} button ${button}`)
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
bot.on('message', (jsonMsg) => {
  const text = jsonMsg.toString().trim()
  if (text) log('INFO', 'chat', text)
})
bot.on('end', (reason) => log('ERROR', 'connection', `disconnected: ${reason}`))

// AFK: bot parado ~5 min e mandado pro "Mundo AFK", onde /bring etc nao funcionam.
// quando isso acontece, so volta pra home (no maximo 1x a cada 30s)
const AFK_MESSAGE = /Você ficou AFK e foi teleportado|Mundo AFK: use/
let lastAfkHomeAt = 0
bot.on('message', (jsonMsg) => {
  if (!AFK_MESSAGE.test(jsonMsg.toString())) return
  if (Date.now() - lastAfkHomeAt < 30000) return

  lastAfkHomeAt = Date.now()
  log('WARN', 'afk', 'moved to AFK world, going /home')
  bot.chat('/home')
})
bot.on('windowOpen', (window) => {
  const items = window.slots.slice(0, window.inventoryStart)
    .map((item, i) => item && `${i}:${item.name}${item.customName ? ` "${item.customName.replace(/§./g, '')}"` : ''}`)
    .filter(Boolean)
  log('INFO', 'window', `opened ${String(window.title).replace(/§./g, '')} | ${items.join(', ')}`)
})

// --- canal IPC com o manager (estado + mapa), separado do stdin pra nao bagunçar o job ---
function blockSymbol(name) {
  if (name.includes('log')) return 'L'
  if (name.includes('leaves')) return '*'
  if (name.includes('water')) return '~'
  if (name.includes('lava')) return '!'
  if (name.includes('fence') || name.includes('wall') || name.includes('pane') || name.includes('bars')) return '#'
  if (name.includes('glass')) return 'g'
  if (name.includes('slab') || name.includes('stairs')) return '='
  if (name.includes('plank')) return 'p'
  if (name.includes('sand')) return ':'
  if (name.includes('wool')) return 'w'
  if (name.includes('clay')) return 'c'
  if (name.includes('quartz')) return 'q'
  if (name === 'grass') return '.'
  if (name === 'dirt') return ','
  if (name.includes('stone') || name.includes('brick') || name.includes('ore')) return 's'
  return '?'
}

const SEE_THROUGH = new Set(['air', 'tallgrass', 'yellow_flower', 'red_flower', 'double_plant', 'deadbush', 'snow_layer'])

// mapa visto de cima: pra cada coluna x,z, o primeiro bloco solido descendo de y+12 ate y-8
function renderMap(radius = 24) {
  if (!bot.entity) return 'not spawned'
  const p = bot.entity.position.floored()
  const counts = {}
  const rows = []
  for (let dz = -radius; dz <= radius; dz++) {
    let row = ''
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dz === 0) { row += '@'; continue }
      let ch = ' '
      for (let dy = 12; dy >= -8; dy--) {
        const b = bot.blockAt(p.offset(dx, dy, dz))
        if (!b) { ch = 'x'; break }
        if (SEE_THROUGH.has(b.name)) continue
        counts[b.name] = (counts[b.name] || 0) + 1
        ch = blockSymbol(b.name)
        break
      }
      row += ch
    }
    rows.push(row)
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, c]) => `${n}:${c}`).join(' ')
  return [
    `center ${p} (north = up, x grows right)`,
    'legend: @ bot  L log  * leaves  ~ water  ! lava  # fence/wall/pane  g glass  = slab/stairs  p planks  : sand  w wool  c clay  q quartz  . grass  , dirt  s stone  ? other  x unloaded',
    ...rows,
    `top blocks: ${top}`
  ].join('\n')
}

function botState() {
  const pos = bot.entity?.position
  return {
    pos: pos ? { x: +pos.x.toFixed(2), y: +pos.y.toFixed(2), z: +pos.z.toFixed(2) } : null,
    dimension: bot.game?.dimension,
    health: bot.health,
    food: bot.food,
    held: bot.heldItem?.name || null,
    pathing: bot.pathfinder?.isMoving() || false,
    inventory: bot.inventory.items().map(item => `${item.name}x${item.count}`),
    drops: pos ? Object.values(bot.entities)
      .filter(e => (e.name === 'item' || e.displayName === 'Item') && e.position.distanceTo(pos) < 16)
      .map(e => ({ item: e.getDroppedItem?.()?.name, dist: +e.position.distanceTo(pos).toFixed(1), y: +e.position.y.toFixed(1) })) : [],
    at: Date.now()
  }
}

if (process.send) {
  setInterval(() => process.send({ type: 'state', state: botState() }), 1000)

  process.on('message', (msg) => {
    if (msg?.type === 'map') {
      process.send({ type: 'map', id: msg.id, text: renderMap(msg.radius) })
    }
  })
}
