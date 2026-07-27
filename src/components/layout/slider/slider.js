import Swiper from 'swiper';
import { Navigation } from 'swiper/modules';
/*
Navigation, Pagination, Autoplay, 
EffectFade, Lazy, Manipulation
*/

import "./slider.scss";
// import 'swiper/css/bundle';

function initSliders() {
	if (document.querySelector('.swiper')) { 
		new Swiper('.swiper', {
			modules: [Navigation],
			observer: true,
			observeParents: true,
			slidesPerView: 1,
			spaceBetween: 0,
			//autoHeight: true,
			speed: 800,

			// Кут свайпа слайдера: реагує лише на більш горизонтальні рухи (за замовч. 45),
			// щоб не конфліктувати з вертикальним перемиканням секцій FullPage
			touchAngle: 40,

			//touchRatio: 0,
			//simulateTouch: false,
			//loop: true,
			//preloadImages: false,
			//lazy: true,

			/*
			effect: 'fade',
			autoplay: {
				delay: 3000,
				disableOnInteraction: false,
			},
			*/

			/*
			pagination: {
				el: '.swiper-pagination',
				clickable: true,
			},
			*/

			/*
			scrollbar: {
				el: '.swiper-scrollbar',
				draggable: true,
			},
			*/

			navigation: {
				prevEl: '.swiper-button-prev',
				nextEl: '.swiper-button-next',
				addIcons: false,
			},
			/*
			breakpoints: {
				640: {
					slidesPerView: 1,
					spaceBetween: 0,
					autoHeight: true,
				},
				768: {
					slidesPerView: 2,
					spaceBetween: 20,
				},
				992: {
					slidesPerView: 3,
					spaceBetween: 20,
				},
				1268: {
					slidesPerView: 4,
					spaceBetween: 30,
				},
			},
			*/
			// Події
			on: {

			}
		});
	}
}
document.querySelector('[data-att-slider]') ?
	window.addEventListener("load", initSliders) : null