import "./ticker.scss"

const DEFAULT_SPEED = 60
const CLONE_LIMIT = 50

function debounce(fn, delay = 150) {
	let timer
	return (...args) => {
		clearTimeout(timer)
		timer = setTimeout(() => fn(...args), delay)
	}
}

function initTicker(root) {
	const line = root.querySelector("[data-att-ticker-line]")
	if (!line) return

	// Оригінальні вузли тримаємо окремо — на кожній перезбірці повертаємо їх
	// у DOM і відкидаємо старі клони
	const source = [...line.children]
	if (!source.length) return

	const speed = parseFloat(root.dataset.attTickerSpeed) || DEFAULT_SPEED
	const isReverse = root.dataset.attTickerDirection === "ltr"

	// Клони дублюють текст для скрінрідера — ховаємо їх від дерева доступності
	const clone = node => {
		const copy = node.cloneNode(true)
		copy.setAttribute("aria-hidden", "true")
		return copy
	}

	const width = el => el.getBoundingClientRect().width

	function build() {
		line.style.animation = "none"
		line.replaceChildren(...source)

		// Добиваємо клонами, поки доріжка не перекриє видиму область
		let guard = 0
		while (width(line) < width(root) && guard++ < CLONE_LIMIT) {
			source.forEach(node => line.append(clone(node)))
		}

		const half = width(line)
		if (!half) return

		// Другий прохід тим самим складом. Далі -50% доріжки = рівно перша
		// половина, а вона ідентична другій: кадр перезапуску збігається
		// з кадром старту, стику не видно
		const filled = [...line.children]
		filled.forEach(node => line.append(clone(node)))

		line.style.animation = `ticker-move ${half / speed}s linear infinite${isReverse ? " reverse" : ""}`
	}

	build()
	// Перший замір може статись до підвантаження Ubuntu Condensed — тоді
	// ширину міряє фолбек-шрифт, і кількість клонів та тривалість будуть хибні
	document.fonts?.ready.then(build)
	window.addEventListener("resize", debounce(build))
}

document.querySelectorAll("[data-att-ticker]").forEach(initTicker)
