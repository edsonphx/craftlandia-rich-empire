const { tokens } = require('../helpers')

module.exports = async function wait(ctx, msg) {
  await ctx.bot.waitForTicks(tokens(msg, '@wait', 1)[0])
}