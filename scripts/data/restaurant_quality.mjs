export function restaurantQualityFactor(averageRating) {
  if (averageRating == null || !Number.isFinite(averageRating)) return null;
  return Math.min(1, Math.max(0.1, (averageRating - 4.0) / 0.7));
}

export function combineRestaurantAccess(count, averageRating) {
  if (count === 0) return 0;
  const quality = restaurantQualityFactor(averageRating);
  return quality == null ? null : count * quality;
}
