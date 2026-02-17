import { messages } from './localization'

export const generateOrderEmailHtml = (order: any, locale: 'ru' | 'ro') => {
  // Формуємо рядки товарів
  const itemRows = order.items
    .map(
      (item: any) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #ededed;">
        <div style="font-weight: bold; font-size: 14px;">${item.title}</div>
        <div style="font-size: 12px; color: #666;">${item.subtitle || ''}</div>
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #ededed; text-align: center; font-size: 14px;">
        ${item.quantity}
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #ededed; text-align: right; font-size: 14px;">
        ${item.price} MDL
      </td>
      <td style="padding: 10px; border-bottom: 1px solid #ededed; text-align: right; font-size: 14px; font-weight: bold;">
        ${item.price * item.quantity} MDL
      </td>
    </tr>
  `
    )
    .join('');

  return `
    <tr>
      <td colspan="2" style="padding: 30px 15px;">
        <h2 style="color: #333; font-size: 18px; margin-bottom: 20px;">
            ${messages.dear[locale]} ${order.shippingAddress?.name || ''}!<br />
        </h2>
        <p style="font-size: 15px; line-height: 1.5; color: #444;">        
          ${messages.thankForYourOrder[locale]} <br />
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 20px; border: 1px solid #ededed;">
          <thead>
            <tr style="background-color: #f9f9f9;">
              <th style="padding: 10px; text-align: left; font-size: 12px; text-transform: uppercase;">${messages.product[locale]}</th>
              <th style="padding: 10px; text-align: center; font-size: 12px; text-transform: uppercase;">${messages.qty[locale]}</th>
              <th style="padding: 10px; text-align: right; font-size: 12px; text-transform: uppercase;">${messages.price[locale]}</th>
              <th style="padding: 10px; text-align: right; font-size: 12px; text-transform: uppercase;">${messages.total[locale]}</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" style="padding: 15px 10px; text-align: right; font-size: 16px; font-weight: bold;">
                ${messages.totalPrice[locale]}
              </td>
              <td style="padding: 15px 10px; text-align: right; font-size: 16px; font-weight: bold; color: #000;">
                ${order.total} MDL
              </td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top: 30px; padding: 15px; background-color: #fdfdfd; border-left: 4px solid #ededed;">
          <h3 style="font-size: 14px; margin: 0 0 10px 0;">${messages.shippingInfo[locale]}</h3>
          <p style="font-size: 13px; margin: 0; color: #555; line-height: 1.4;">
            <strong>${messages.address[locale]}:</strong> ${order.shippingAddress?.city}, ${order.shippingAddress?.address}<br />
            <strong>${messages.phone[locale]}:</strong> ${order.shippingAddress?.phone}<br />
            <strong>${messages.comment[locale]}</strong> ${order.comment || ''}
          </p>
        </div>
      </td>
    </tr>
  `;
};