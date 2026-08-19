module.exports = async function sethome(ctx, msg) {
  const name = msg.replace('@sethome', '').trim()
  await ctx.helpers.setHome(ctx.bot, name)
}