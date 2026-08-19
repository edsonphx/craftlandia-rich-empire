const { tokens } = require('../helpers')

async function chopTree(bot) {
  const tree = locateNearestTree(bot)
  if (!tree) {
    log('WARN', 'chop', 'no tree found')
    return
  }

  await goTo(bot, tree.position.x, tree.position.y, tree.position.z)
  await bot.waitForTicks(13)

  await breakTree(bot, tree.position.x, tree.position.y + 2, tree.position.z)
}

module.exports = async function chop(ctx, msg) {
  const { bot, helpers } = ctx
  const times = parseInt(tokens(msg, '@chop', 1)[0]) || 1

  for (let i = 0; i < times; i++) {
    await helpers.ensureFoodStock(bot)
    await helpers.ensureFed(bot)
    await helpers.checkAxeSupply(bot)

    try {
      await chopTree(bot)
    } catch (error) {
      helpers.log('WARN', 'chop', 'retrying chop after failure')
      await chopTree(bot)
    }

    helpers.log('INFO', 'progress', `${i + 1}/${times}`)
  }
}