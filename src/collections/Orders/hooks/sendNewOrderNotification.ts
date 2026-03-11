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
  if (operation === 'create') {
    try {
      const formattedDocs = await getNormalizedOrders([doc], req);
      const newDoc = {
        ...formattedDocs[0],
        shippingAddress: doc.shippingAddress,
        comment: doc.comment
      }
      await req.payload.sendEmail({
        to: doc.shippingAddress.email,
        subject: `NextLevel Shop new order #${doc.orderNumber}`,
        html: `${emailHeader}${generateOrderEmailHtml(newDoc, req.locale as 'ru' || 'ro')}${emailFooter}`,
      })
      const botToken = process.env.TELEGRAM_BOT_TOKEN
      const chatId = process.env.TELEGRAM_CHAT_ID
      if (!botToken || !chatId) {
        console.error('Telegram env variables are missing')
        return
      }
      const message = buildTelegramMessage(newDoc, req.locale)
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      })
    } catch (error) {
      req.payload.logger.error(`email sending error: ${error}`)
    }
  }
}