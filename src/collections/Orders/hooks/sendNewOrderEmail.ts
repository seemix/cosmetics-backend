import { CollectionAfterChangeHook } from 'payload'

import { emailHeader } from '@/email-templates/email-header'
import { emailFooter } from '@/email-templates/email-footer'
import { generateOrderEmailHtml } from '@/email-templates/new-order'
import { getNormalizedOrders } from '@/collections/Orders/services/getNormalizedOrders'

export const sendNewOrderEmail: CollectionAfterChangeHook = async ({
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
    } catch (error) {
      req.payload.logger.error(`email sending error: ${error}`)
    }
  }
}