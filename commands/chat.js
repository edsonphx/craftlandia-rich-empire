module.exports = async function chat(ctx, msg) {
  ctx.bot.chat(msg.replace('@chat ', ''))
}