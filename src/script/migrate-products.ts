import { getPayload } from 'payload'
import config from '../payload.config'

const migrate = async () => {
  const payload = await getPayload({ config })

  // 1. Отримуємо всі продукти
  const products = await payload.find({
    collection: 'products',
    limit: 0, // отримати всі записи
    pagination: false,
  })

  console.log(`Found ${products.docs.length} products to update.`)

  // 2. Оновлюємо кожен продукт
  for (const product of products.docs) {
    try {
      await payload.update({
        collection: 'products',
        id: product.id,
        data: {
          // Ми можемо передати порожній об'єкт або будь-яке поле,
          // хук beforeChange все одно спрацює і заповнить titleWithArticle
          id: product.id,
        },
      })
      console.log(`Updated: ${product.id}`)
    } catch (err) {
      console.error(`Failed to update ${product.id}:`, err)
    }
  }

  console.log('Migration finished!')
  process.exit(0)
}

migrate().then()