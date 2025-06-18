export function getLevelDepth(position: string): number {
  return position.split(':').length;
}

export function isSpousePosition(position: string): boolean {
  return position.split(':').length === 3;
}