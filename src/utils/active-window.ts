/** Mongo filter for a date-windowed record that is live right now (a missing start/end means open-ended). */
export function activeWindowFilter(startField = "startsAt", endField = "endsAt", now = new Date()) {
  return {
    isActive: true,
    $and: [
      { $or: [{ [startField]: null }, { [startField]: { $lte: now } }] },
      { $or: [{ [endField]: null }, { [endField]: { $gte: now } }] },
    ],
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
