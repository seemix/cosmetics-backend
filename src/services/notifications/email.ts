import type { PayloadRequest } from 'payload'

import { EXTERNAL_TIMEOUT_MS, withTimeout } from './withTimeout'

type EmailMessage = Parameters<PayloadRequest['payload']['sendEmail']>[0]

/**
 * Надсилає лист з таймаутом. Збій пошти не кидає помилку, а пишеться в лог,
 * щоб не ламати операцію, яка цей лист ініціювала.
 */
export async function sendEmailSafely(req: PayloadRequest, message: EmailMessage): Promise<boolean> {
  try {
    await withTimeout(req.payload.sendEmail(message), EXTERNAL_TIMEOUT_MS, 'Email')
    return true
  } catch (error) {
    req.payload.logger.error({ err: error }, `Email sending failed: ${message?.subject ?? ''}`)
    return false
  }
}
