module.exports = async function call(ctx, msg) {
  ctx.bot.chat(`/call ${ctx.username}`)
}