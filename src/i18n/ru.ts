import type { CustomTranslationsObject } from './types'

export const ru: CustomTranslationsObject = {
  custom: {
    status: {
      draft: 'Черновик',
      posted: 'Проведён',
      reversed: 'Сторнирован',
    },
    term: {
      amount: 'Сумма',
      comment: 'Комментарий',
      cost: 'Себестоимость',
      date: 'Дата',
      kind: 'Тип',
      number: 'Номер',
      product: 'Товар',
      quantity: 'Количество',
      reason: 'Причина',
      reversalReason: 'Причина сторно',
      status: 'Статус',
      supplier: 'Поставщик',
      total: 'Итого',
      unitPrice: 'Цена за единицу',
      warehouse: 'Склад',
    },
    action: {
      post: 'Проведение',
      reverse: 'Сторно',
    },
    period: {
      closed: 'Закрытый период',
    },
    group: {
      purchasing: 'Закупки',
      stock: 'Склад',
      ecommerce: 'Магазин',
      content: 'Контент',
      users: 'Пользователи',
    },
    validation: {
      integer: 'Значение должно быть целым числом',
      wholeBani: 'Сумма должна быть целым числом бани',
    },
    error: {
      periodLocked: 'Период закрыт до {{date}}',
      insufficientStock: 'Недостаточно товара на складе: {{product}} ({{warehouse}}), запрошено {{requested}}, доступно {{available}}',
      postedOrderLocked: 'Проведённый заказ нельзя редактировать: позиции, сумма, скидка и клиент зафиксированы',
      cancelledIsFinal: 'Отменённый заказ нельзя вернуть в работу, создайте новый заказ',
      postedOrderDeleteForbidden: 'Проведённый заказ нельзя удалить, отмените его',
    },
  },
}
