module.exports = async function gohome(ctx, msg) {
  const name = msg.replace('@gohome', '').trim()
  await ctx.helpers.goHome(ctx.bot, name)
}