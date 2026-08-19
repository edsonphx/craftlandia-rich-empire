module.exports = async function sell(ctx) {
  const { bot, helpers } = ctx
  await helpers.warpToShop(bot)

  await helpers.goTo(bot, -677, 6, 728)
  await helpers.goTo(bot, -677, 6, 663)
  helpers.log('INFO', 'shop', 'checkpoint AMENO reached')

  await helpers.goTo(bot, -644, 6, 653)
  helpers.log('INFO', 'shop', 'arrived at sell point')

  for (let z = 651; z <= 656; z++) {
    await helpers.clickSell(bot, -644, 7, z)
  }

  await bot.waitForTicks(20 * 6)
  helpers.log('INFO', 'shop', 'sell complete')
}