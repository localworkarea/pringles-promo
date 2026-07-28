
import './winners.scss'


const ACTIVE_ATTR = 'data-att-popup-active'

function initVideoPopup() {
	const popup = document.querySelector('[data-att-popup="video"]')
	const player = popup?.querySelector('[data-att-popup-video-player]')
	if (!player) return

	document.addEventListener('click', event => {
		const button = event.target.closest('[data-att-popup-video]')
		if (!button) return
		const src = button.dataset.attPopupVideo
		if (src && player.getAttribute('src') !== src) {
			player.setAttribute('src', src)
			player.load()
		}
	})

	new MutationObserver(() => {
		if (popup.hasAttribute(ACTIVE_ATTR)) {
			// Автоплей може бути заблокований політикою браузера — тоді
			// лишаються звичайні контроли програвача, помилку глушимо
			player.play().catch(() => { })
		} else {
			player.pause()
			player.currentTime = 0
		}
	}).observe(popup, { attributes: true, attributeFilter: [ACTIVE_ATTR] })
}

initVideoPopup()
