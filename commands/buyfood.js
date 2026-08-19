module.exports = async function buyfood(ctx) {
  await ctx.helpers.buyFood(ctx.bot)
}