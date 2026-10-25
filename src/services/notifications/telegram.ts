import axios from 'axios'

import { EXTERNAL_TIMEOUT_MS } from './withTimeout'

/** Виклик методу Telegram Bot API з таймаутом. Помилки кидає далі, обробляє викликач. */
export function callTelegram(botToken: string, method: string, body: Record<string, unknown>) {
  return axios.post(`https://api.telegram.org/bot${botToken}/${method}`, body, {
    timeout: EXTERNAL_TIMEOUT_MS,
  })
}
