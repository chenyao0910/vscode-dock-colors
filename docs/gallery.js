const colors = [
  'Default', 'Purple', 'Pink', 'Green', 'Orange', 'Red', 'Teal',
  'Lavender', 'Mint', 'Gold', 'Coral', 'Indigo', 'Sky', 'Dark',
]

const gallery = document.querySelector('#icons')
const dockIcon = document.querySelector('#dock-icon')
const dockLabel = document.querySelector('#dock-label')
for (const color of colors) {
  for (const background of ['original', 'black']) {
    const black = background === 'black'
    const card = document.createElement('figure')
    card.dataset.background = background

    const image = document.createElement('img')
    image.src = `icons/${color.toLowerCase()}${black ? '-black' : ''}.png`
    image.alt = ''
    image.width = 96
    image.height = 96
    image.loading = 'lazy'

    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-pressed', String(color === 'Default' && !black))

    const caption = document.createElement('span')
    caption.textContent = black ? `${color} (Black)` : color
    button.append(image, caption)
    button.addEventListener('click', () => {
      gallery.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false')
      button.setAttribute('aria-pressed', 'true')
      dockIcon.src = image.src
      dockLabel.textContent = caption.textContent
    })
    card.append(button)
    gallery.append(card)
  }
}

const filters = document.querySelectorAll('[data-filter]')
for (const filter of filters) {
  filter.addEventListener('click', () => {
    const selected = filter.dataset.filter
    for (const button of filters) {
      button.setAttribute('aria-pressed', String(button === filter))
    }
    for (const card of gallery.children) {
      card.hidden = selected !== 'all' && card.dataset.background !== selected
    }
  })
}
