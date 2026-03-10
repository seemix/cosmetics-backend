import { CollectionAfterChangeHook } from 'payload'
import { buildTelegramMessage } from '@/collections/Orders/services/buildTelegramMessage'

export const sendTelegramNotification: CollectionAfterChangeHook = async ({ doc, req, operation }) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    console.error('Telegram env variables are missing')
    return
  }

  if (operation === 'create') {
    try {
      const message = buildTelegramMessage(doc, req.locale)

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML',
        }),
      })
    } catch (error) {
      console.error('Telegram notification error:', error)
    }
  }
}



