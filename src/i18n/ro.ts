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
      ecommerce: 'Magazin',
      content: 'Conținut',
      users: 'Utilizatori',
    },
    validation: {
      integer: 'Valoarea trebuie să fie un număr întreg',
      wholeBani: 'Suma trebuie să fie un număr întreg de bani',
    },
    error: {
      periodLocked: 'Perioada este închisă până la {{date}}',
      insufficientStock: 'Stoc insuficient: {{product}} în depozitul {{warehouse}}, solicitat {{requested}}, disponibil {{available}}',
      postedOrderLocked: 'Comanda operată nu poate fi editată: pozițiile, suma, reducerea și clientul sunt fixate',
      cancelledIsFinal: 'Comanda anulată nu poate fi redeschisă, creați o comandă nouă',
      postedOrderDeleteForbidden: 'Comanda operată nu poate fi ștearsă, anulați-o',
    },
  },
}
