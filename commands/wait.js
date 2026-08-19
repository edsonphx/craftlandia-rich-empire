const { tokens } = require('../helpers')

module.exports = async function wait(ctx, msg) {
  await ctx.bot.waitForTicks(getParams(msg, '@wait', 1)[0])
}