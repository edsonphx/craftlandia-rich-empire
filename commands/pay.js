const { tokens } = require('../helpers')

module.exports = async function pay(ctx, msg) {
  const { bot, log } = ctx
  const amount = getParams(msg, '@pay', 1)[0]

  bot.chat(`/money pay ${ctx.username} ${amount}`)
  await bot.waitForTicks(15)
  bot.chat(`/money pay ${ctx.username} ${amount}`)
  log('INFO', 'economy', `paid ${amount} to ${ctx.username}`)
}