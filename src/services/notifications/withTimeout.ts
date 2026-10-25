/** Скільки чекаємо на відповідь зовнішнього сервісу (Telegram, DeepL, пошта). */
export const EXTERNAL_TIMEOUT_MS = 10_000

/** Відхиляє проміс, якщо зовнішній сервіс не відповів за `ms` мілісекунд. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: no response in ${ms} ms`)), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}
