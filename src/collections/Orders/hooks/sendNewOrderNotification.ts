import type { CollectionAfterChangeHook } from 'payload'

import { emailHeader } from '@/email-templates/email-header'
import { emailFooter } from '@/email-templates/email-footer'
import { generateOrderEmailHtml } from '@/email-templates/new-order'
import { getNormalizedOrders } from '@/collections/Orders/services/getNormalizedOrders'
import { buildTelegramMessage } from '@/collections/Orders/services/buildTelegramMessage'
import { runAfterCommit } from '@/services/notifications/afterCommit'
import { sendEmailSafely } from '@/services/notifications/email'
import { callTelegram } from '@/services/notifications/telegram'

type HookArgs = Parameters<CollectionAfterChangeHook>[0]

export const sendNewOrderNotification: CollectionAfterChangeHook = async (args) => {
  // Хук виконується до коміту транзакції. Якщо транзакцію відкрив createOrder,
  // сповіщення підуть лише після коміту, тож для відкоченого замовлення їх не буде.
  await runAfterCommit(args.req, () => notify(args))
}

const notify = async ({ doc, req, operation }: HookArgs) => {
  try {
    const formattedDocs = await getNormalizedOrders([doc], req);
    const newDoc = {
      ...formattedDocs[0],
      paymentType: doc.paymentType,
      shippingAddress: doc.shippingAddress,
      SRL: doc.SRL,
      comment: doc.comment,
      promoCodeApplied: doc.promoCodeApplied,
      discount: doc.discount
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID

    if (operation === 'create') {
      const subject = `NextLevel Shop ${req.locale === 'ru' ? `Новый заказ` : 'Nouă ordine'} #${doc.orderNumber}`
      await sendEmailSafely(req, {
        to: doc.shippingAddress.email,
        subject,
        html: `${emailHeader}${generateOrderEmailHtml(newDoc, req.locale as 'ru' || 'ro')}${emailFooter}`,
      })
    }

    if (!botToken || !chatId) {
      req.payload.logger.warn('Telegram env variables are missing')
      return
    }

    const message = buildTelegramMessage(newDoc)

    if (operation === 'create') {
      const res = await callTelegram(botToken, 'sendMessage', {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      })

      const messageId = res.data?.result?.message_id
      if (messageId) {
        await req.payload.update({
          collection: 'orders',
          id: doc.id,
          data: {
            telegramMessageId: String(messageId),
          },
          req,
        })
      }
    } else if (operation === 'update' && doc.telegramMessageId) {
      try {
        await callTelegram(botToken, 'editMessageText', {
          chat_id: chatId,
          message_id: Number(doc.telegramMessageId),
          text: message,
          parse_mode: 'HTML',
        })

        await callTelegram(botToken, 'setMessageReaction', {
          chat_id: chatId,
          message_id: Number(doc.telegramMessageId),
          reaction: [
            {
              type: 'emoji',
              emoji: '✍',
            },
          ],
          is_big: true,
        })

      } catch (e: any) {
        const errorDesc = e.response?.data?.description || e.message || ''
        if (!errorDesc.includes('message is not modified')) {
          req.payload.logger.error(`Telegram update error: ${errorDesc}`)
        }
      }
    }

  } catch (error) {
    req.payload.logger.error(`Notification hook error: ${error}`)
  }
}
