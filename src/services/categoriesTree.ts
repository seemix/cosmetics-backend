export const categoriesTree = (categories, brands) => {
  const map = {}
  const roots = []

  categories.forEach(cat => {
    map[cat.id] = { ...cat, sub: [] }
  })

  categories.forEach(cat => {
    const itemToPush = { ...map[cat.id], uri: '/category/' + map[cat.id].slug }
    if (cat.parent) {
      map[cat.parent]?.sub.push(itemToPush)
    } else {
      roots.push(itemToPush)
    }
  })
  brands.forEach(brand => {
    brand.uri = '/brand/' + brand.slug
  })
  return { categories: [...roots], brands: [...brands] }
}