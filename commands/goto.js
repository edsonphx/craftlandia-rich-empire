const { tokens } = require('../helpers')

module.exports = async function goto(ctx, msg) {
  const { bot, helpers } = ctx
  const [x, y, z] = getParams(msg, '@goto', 3).map(v => parseInt(v))
  await helpers.goTo(bot, x, y, z)
}