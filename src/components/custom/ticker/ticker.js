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


	const source = [...line.children]
	if (!source.length) return

	const speed = parseFloat(root.dataset.attTickerSpeed) || DEFAULT_SPEED
	const isReverse = root.dataset.attTickerDirection === "ltr"


	const clone = node => {
		const copy = node.cloneNode(true)
		copy.setAttribute("aria-hidden", "true")
		return copy
	}

	const width = el => el.getBoundingClientRect().width

	function build() {
		line.style.animation = "none"
		line.replaceChildren(...source)

	
		let guard = 0
		while (width(line) < width(root) && guard++ < CLONE_LIMIT) {
			source.forEach(node => line.append(clone(node)))
		}

		const half = width(line)
		if (!half) return


		const filled = [...line.children]
		filled.forEach(node => line.append(clone(node)))

		line.style.animation = `ticker-move ${half / speed}s linear infinite${isReverse ? " reverse" : ""}`
	}

	build()

	document.fonts?.ready.then(build)

	const rebuild = debounce(build)
	let lastWidth = null
	const observer = new ResizeObserver(entries => {

		requestAnimationFrame(() => {
			for (const entry of entries) {
				const currentWidth = Math.round(entry.contentRect.width)

				if (lastWidth === null) {
					lastWidth = currentWidth
					continue
				}
				if (currentWidth === lastWidth) continue
				lastWidth = currentWidth
				rebuild()
			}
		})
	})
	observer.observe(root)
}

document.querySelectorAll("[data-att-ticker]").forEach(initTicker)
