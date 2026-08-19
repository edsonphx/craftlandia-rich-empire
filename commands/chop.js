const { tokens } = require('../helpers')

module.exports = async function chop(ctx, msg) {
  const { bot, helpers } = ctx
  const times = parseInt(tokens(msg, '@chop', 1)[0]) || 1

  for (let i = 0; i < times; i++) {
    await helpers.ensureFoodStock(bot)
    await helpers.ensureFed(bot)
    await helpers.checkAxeSupply(bot)

    try {
      await helpers.chopTree(bot)
    } catch (error) {
      helpers.log('WARN', 'chop', 'retrying chop after failure')
      await helpers.chopTree(bot)
    }

    helpers.log('INFO', 'progress', `${i + 1}/${times}`)
  }
}