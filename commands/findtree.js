module.exports = async function findtree(ctx) {
  const { bot, helpers, log } = ctx
  const tree = helpers.locateNearestTree(bot)
  log('INFO', 'chop', tree ? `nearest tree at ${tree.position}` : 'no tree found')
}