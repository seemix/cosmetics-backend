import axios from 'axios'
import { CollectionAfterChangeHook } from 'payload'

import { emailHeader } from '@/email-templates/email-header'
import { emailFooter } from '@/email-templates/email-footer'
import { generateOrderEmailHtml } from '@/email-templates/new-order'
import { getNormalizedOrders } from '@/collections/Orders/services/getNormalizedOrders'
import { buildTelegramMessage } from '@/collections/Orders/services/buildTelegramMessage'

export const sendNewOrderNotification: CollectionAfterChangeHook = async ({
                                                                            doc,
                                                                            req,
                                                                            operation,
                                                                          }) => {
  try {
    const formattedDocs = await getNormalizedOrders([doc], req);
    const newDoc = {
      ...formattedDocs[0],
      paymentType: doc.paymentType,
      shippingAddress: doc.shippingAddress,
      comment: doc.comment
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN
    const chatId = process.env.TELEGRAM_CHAT_ID
    const telegramApi = `https://api.telegram.org/bot${botToken}`

    if (operation === 'create') {
      const subject = `NextLevel Shop ${req.locale === 'ru' ? `Новый заказ` : 'Nouă ordine'} #${doc.orderNumber}`
      await req.payload.sendEmail({
        to: doc.shippingAddress.email,
        subject,
        html: `${emailHeader}${generateOrderEmailHtml(newDoc, req.locale as 'ru' || 'ro')}${emailFooter}`,
      })
    }

    if (!botToken || !chatId) {
      console.error('Telegram env variables are missing')
      return
    }

    const message = buildTelegramMessage(newDoc, req.locale as 'ru' || 'ro')

    if (operation === 'create') {
      const res = await axios.post(`${telegramApi}/sendMessage`, {
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
        })
      }
    } else if (operation === 'update' && doc.telegramMessageId) {
      try {
        await axios.post(`${telegramApi}/editMessageText`, {
          chat_id: chatId,
          message_id: Number(doc.telegramMessageId),
          text: message,
          parse_mode: 'HTML',
        })

        await axios.post(`${telegramApi}/setMessageReaction`, {
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
        const errorDesc = e.response?.data?.description || ''
        if (!errorDesc.includes('message is not modified')) {
          req.payload.logger.error(`Telegram update error: ${errorDesc}`)
        }
      }
    }

  } catch (error) {
    req.payload.logger.error(`Notification hook error: ${error}`)
  }
}