import { Category, Brand } from '@/payload-types'

export const categoriesTree = (categories: Category[], brands: Brand[]) => {
  const map: Record<string, any> = {}
  const roots: any[] = []

  categories.forEach(cat => {
    map[cat.id] = { ...cat, sub: [] }
  })

  categories.forEach(cat => {
    // Додаємо безпечну перевірку на наявність id
    const currentCat = map[cat.id]
    const itemToPush = { ...currentCat, uri: '/category/' + currentCat.slug }

    if (cat.parent) {
      // Якщо parent — це об'єкт (через populate), беремо id, інакше саме поле
      const parentId = typeof cat.parent === 'object' ? cat.parent.id : cat.parent
      map[parentId]?.sub.push(itemToPush)
    } else {
      roots.push(itemToPush)
    }
  })

  brands.forEach(brand => {
    (brand as any).uri = '/brand/' + brand.slug
  })

  return { categories: roots, brands: brands }
}