module.exports = async function position(ctx) {
  const pos = ctx.bot.entity.position
  ctx.log('INFO', 'movement', `x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}`)
}