const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

function log(level, module, message) {
  const time = new Date().toTimeString().split(' ')[0]
  console.log(`[${time}] [${level}] [${module}] ${message}`)
}

function countItems(bot, name) {
  return bot.inventory.items()
    .filter(item => item && item.name === name)
    .reduce((total, item) => total + item.count, 0)
}

function findItem(bot, name) {
  return bot.inventory.items().find(item => item && item.name === name) || null
}

function getParams(msg, cmd, n) {
  return msg.replace(cmd, '').trim().split(/\s+/).slice(0, n)
}

async function goTo(bot, x, y, z) {
  const goal = new goals.GoalNear(x, y, z, 1)
  await bot.pathfinder.goto(goal)
  log('INFO', 'movement', `arrived at (${x}, ${y}, ${z})`)
}

let lastTree = null
function locateNearestTree(bot, maxDistance = 32) {
  const block = bot.findBlock({
    maxDistance,
    matching: (b) => {
      if (!b.name.includes('log')) return false
      if (lastTree && b.position.x === lastTree.x && b.position.z === lastTree.z) return false

      const above = bot.blockAt(b.position.offset(0, 1, 0))
      const below = bot.blockAt(b.position.offset(0, -1, 0))
      return above?.name.includes('log') || below?.name.includes('log')
    }
  })

  if (!block) return null

  let pos = block.position

  while (bot.blockAt(pos.offset(0, -1, 0))?.name.includes('log')) {
    pos = pos.offset(0, -1, 0)
  }

  lastTree = { x: pos.x, z: pos.z }

  return bot.blockAt(pos)
}

async function breakTree(bot, x, y, z) {
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

async function interactAt(bot, x, y, z, act, label) {
  const block = bot.blockAt(new Vec3(x, y, z))
  if (!block) {
    log('WARN', 'shop', 'no block found at that position')
    return
  }

  await bot.lookAt(block.position.offset(0.5, 0.5, 0.5))
  await act(block)
  log('INFO', 'shop', `${label} on ${block.name} at ${block.position}`)
}

function clickBuy(bot, x, y, z) {
  return interactAt(bot, x, y, z, (block) => bot.activateBlock(block), 'buy click')
}

function clickSell(bot, x, y, z) {
  return interactAt(bot, x, y, z, (block) => bot.dig(block), 'sell click (dig)')
}

async function sneakBuy(bot, x, y, z) {
  bot.setControlState('sneak', true)
  await clickBuy(bot, x, y, z)
  bot.setControlState('sneak', false)
}

async function warpToShop(bot) {
  bot.chat('/warp loja')
  await bot.waitForTicks(20 * 10)
  bot.chat('/menuloja off')
}

async function buyDiamond(bot) {
  await warpToShop(bot)

  await goTo(bot, -677, 6, 728)
  await goTo(bot, -677, 6, 663)
  await goTo(bot, -700, 6, 639)
  await goTo(bot, -703, 6, 627)
  log('INFO', 'shop', 'checkpoint AMENO3 reached')

  await goTo(bot, -700, 6, 607)
  log('INFO', 'shop', 'arrived at diamond shop')

  await sneakBuy(bot, -700, 7, 605)

  log('INFO', 'shop', 'diamond purchase complete')
}

async function buyFood(bot) {
  await warpToShop(bot)

  await goTo(bot, -677, 6, 728)
  await goTo(bot, -677, 6, 663)
  log('INFO', 'shop', 'checkpoint AMENO2 reached')

  await goTo(bot, -662, 6, 605)
  log('INFO', 'shop', 'arrived at food shop')

  await sneakBuy(bot, -663, 7, 605)

  log('INFO', 'shop', 'food purchase complete')
}

async function setHome(bot, name = "") {
  bot.chat('/sethome ' + name)
  await bot.waitForTicks(13)
  bot.chat('/sethome ' + name)
  log('INFO', 'home', name ? `home set: ${name}` : 'home set')
}

async function goHome(bot, name = "") {
  log('INFO', 'home', `warping home${name ? ': ' + name : ''}`)
  bot.chat('/home ' + name)
  await bot.waitForTicks(20 * 13)
  log('INFO', 'home', 'home reached')
}

async function eat(bot) {
  const food = findItem(bot, 'cooked_beef')

  if (!food) {
    log('WARN', 'survival', 'no cooked_beef to eat')
    return
  }

  await bot.waitForTicks(20)
  await bot.equip(food, 'hand')
  await bot.consume()
  log('INFO', 'survival', `ate ${food.count} cooked_beef`)
  await bot.waitForTicks(20)
  const axe = findItem(bot, 'diamond_axe')
  await bot.waitForTicks(20)
  if (axe) await bot.equip(axe, 'hand')
}

async function restock(bot, shopFn, homeName = '') {
  await setHome(bot, homeName)
  await bot.waitForTicks(13)
  await shopFn(bot)
  await goHome(bot, homeName)
}

async function ensureDiamondstock(bot) {
  await bot.waitForTicks(20)
  const diamondCount = countItems(bot, 'diamond')

  if (diamondCount < 1) {
    log('WARN', 'diamonds', `diamonds count low: ${diamondCount}`)
    await restock(bot, buyDiamond, 'tmp')
  }
}

async function ensureFoodStock(bot) {
  const meatCount = countItems(bot, 'cooked_beef')

  if (meatCount < 1) {
    log('WARN', 'survival', `meat count low: ${meatCount}`)
    await restock(bot, buyFood, 'tmp')
  }
}

async function ensureFed(bot) {
  if (bot.food < 15) {
    log('WARN', 'survival', `food low: ${bot.food}`)
    await eat(bot)
  }
}

async function checkAxeSupply(bot) {
  const axeCount = countItems(bot, 'diamond_axe')

  if (axeCount < 1) {
    log('WARN', 'inventory', `not enough axes: ${axeCount}/1`)
    await craftAxe(bot)
  }
}

function countLogs(logs) {
  return logs.reduce((total, item) => total + item.count, 0)
}

async function craftAxe(bot) {
  await bot.waitForTicks(20)

  const logs = bot.inventory.items().filter(item => item.name.includes('log'))
  let logCount = countLogs(logs)

  if (logCount < 2) {
    log('WARN', 'craft', `not enough logs for axe: ${logCount}/2`)
    await chopTree(bot)
    await bot.waitForTicks(20)
    logs.length = 0
    logs.push(...bot.inventory.items().filter(item => item.name.includes('log')))
    logCount = countLogs(logs)
    log('INFO', 'craft', `logs after chop: ${logCount}`)
  }

  log('INFO', 'craft', 'log OK')
  await ensureDiamondstock(bot)

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

    const tableItem = findItem(bot, 'crafting_table')
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

module.exports = {
  log,
  tokens,
  countItems,
  findItem,
  goTo,
  locateNearestTree,
  breakTree,
  interactAt,
  clickBuy,
  clickSell,
  sneakBuy,
  warpToShop,
  buyDiamond,
  buyFood,
  chopTree,
  setHome,
  goHome,
  eat,
  restock,
  ensureDiamondstock,
  ensureFoodStock,
  ensureFed,
  checkAxeSupply,
  countLogs,
  craftAxe,
}