export function generatePromo(length = 5): string {

  const chars = '23456789ABCDEFGHJKLMNRSTUVZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}