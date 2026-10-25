import type { CustomTranslationsObject } from './types'

export const ro: CustomTranslationsObject = {
  custom: {
    status: {
      draft: 'Ciornă',
      posted: 'Operat',
      reversed: 'Stornat',
    },
    term: {
      amount: 'Sumă',
      comment: 'Comentariu',
      cost: 'Preț de cost',
      date: 'Data',
      kind: 'Tip',
      number: 'Număr',
      product: 'Produs',
      quantity: 'Cantitate',
      reason: 'Motiv',
      reversalReason: 'Motivul stornării',
      status: 'Stare',
      supplier: 'Furnizor',
      total: 'Total',
      unitPrice: 'Preț unitar',
      warehouse: 'Depozit',
    },
    action: {
      post: 'Operare',
      reverse: 'Stornare',
    },
    period: {
      closed: 'Perioadă închisă',
    },
    group: {
      purchasing: 'Achiziții',
      stock: 'Depozit',
    },
    validation: {
      integer: 'Valoarea trebuie să fie un număr întreg',
      wholeBani: 'Suma trebuie să fie un număr întreg de bani',
    },
  },
}
