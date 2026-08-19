const { tokens } = require('../helpers')

module.exports = async function treebreak(ctx, msg) {
  const { bot, helpers } = ctx
  const [x, y, z] = tokens(msg, '@treebreak', 3).map(parseFloat)
  await helpers.breakTree(bot, x, y, z)
}