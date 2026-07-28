// ---------------------------------------------------------------------------
// МАСКА ТЕЛЕФОНУ (Україна)
//
//   <input type="tel" data-att-form-phone
//          pattern="\+38-\(0\d{2}\)-\d{3}-\d{2}-\d{2}">
//
// Формат: +38-(0XX)-XXX-XX-XX. Код країни та транковий 0 фіксовані,
// користувач вводить рівно 9 цифр.
//
// Дев'ять цифр після +380 — це весь план нумерації України: і мобільні
// (2-значний код оператора), і стаціонарні (2-значний код регіону, Київ 44).
// Коди операторів навмисно НЕ перевіряємо: у 2024 додали 075, будь-який
// зашитий список рано чи пізно почне відбраковувати справжні номери.
// ---------------------------------------------------------------------------

const PREFIX = "+38-(0"
const PREFIX_DIGITS = 3 // 3, 8, 0 — завжди на початку значення
const MAX_DIGITS = 9

function format(digits) {
	// Роздільник додається лише коли почалась наступна група — інакше
	// у значенні висів би ")" чи "-", який браузер стирає на Backspace,
	// а маска одразу повертає назад, і видалення "залипає"
	let out = PREFIX + digits.slice(0, 2)
	if (digits.length > 2) out += `)-${digits.slice(2, 5)}`
	if (digits.length > 5) out += `-${digits.slice(5, 7)}`
	if (digits.length > 7) out += `-${digits.slice(7, 9)}`
	return out
}

// Дістає 9 значущих цифр із будь-якого запису: +380931234567, 380931234567,
// 0931234567 і 931234567 дають однаковий результат.
//
// Разом із цифрами повертає offset — скільки провідних цифр відкинуто.
// Без нього не порахувати каретку: коли користувач виділяє все й одразу
// друкує, у значенні лишається сама лише нова цифра, фіксованих 380 там
// ще немає, і віднімати від позиції фіксовану трійку не можна
function normalize(value) {
	const all = value.replace(/\D/g, "")
	let rest = all
	let offset = 0
	if (rest.startsWith("380")) {
		rest = rest.slice(3)
		offset = 3
	}
	while (rest.length > MAX_DIGITS) {
		if (rest.startsWith("380")) { rest = rest.slice(3); offset += 3 }
		else if (rest.startsWith("38")) { rest = rest.slice(2); offset += 2 }
		else if (rest.startsWith("0")) { rest = rest.slice(1); offset += 1 }
		else break
	}
	return { digits: rest.slice(0, MAX_DIGITS), offset }
}

function initPhone(input) {
	const caretToEndOfPrefix = () => input.setSelectionRange(PREFIX.length, PREFIX.length)

	// Позиція одразу після N-ї введеної цифри
	function caretAfter(count) {
		if (count <= 0) return PREFIX.length
		let seen = 0
		for (let i = 0; i < input.value.length; i++) {
			if (!/\d/.test(input.value[i])) continue
			seen++
			if (seen === count + PREFIX_DIGITS) return i + 1
		}
		return input.value.length
	}

	input.addEventListener("focus", () => {
		if (!input.value) input.value = PREFIX
		// focus спрацьовує до того, як клік поставить каретку, тому чекаємо кадр
		requestAnimationFrame(() => {
			if ((input.selectionStart ?? 0) < PREFIX.length) caretToEndOfPrefix()
		})
	})

	input.addEventListener("click", () => {
		if ((input.selectionStart ?? 0) < PREFIX.length) caretToEndOfPrefix()
	})

	// Префікс невидаляльний. Без цього Backspace після останньої цифри починав
	// відкушувати "+38-(0", а маска дописувала з'їдені цифри назад у номер —
	// значення стрибало (+38-(038 → +38-(03 → +38-(0 → +38-(038) і виглядало
	// так, ніби нічого не стирається
	input.addEventListener("beforeinput", event => {
		const start = input.selectionStart ?? 0
		// Виділення обробляємо як є: воно може легально накривати весь рядок
		if (start !== (input.selectionEnd ?? 0)) return

		if (event.inputType.startsWith("delete")) {
			const backward = event.inputType.includes("Backward")
			if (backward ? start <= PREFIX.length : start < PREFIX.length) event.preventDefault()
			return
		}
		// Ввід усередині префікса — переносимо каретку за нього
		if (start < PREFIX.length) caretToEndOfPrefix()
	})

	input.addEventListener("input", () => {
		const caret = input.selectionStart ?? input.value.length
		const digitsLeft = (input.value.slice(0, caret).match(/\d/g) || []).length
		const { digits, offset } = normalize(input.value)
		const typedLeft = Math.max(0, digitsLeft - offset)
		input.value = format(digits)
		const position = caretAfter(Math.min(typedLeft, digits.length))
		input.setSelectionRange(position, position)
	})

	// Пішли з поля, не ввівши жодної цифри — прибираємо префікс, щоб
	// повернувся плейсхолдер і required бачив поле порожнім
	input.addEventListener("blur", () => {
		if (!normalize(input.value).digits.length) input.value = ""
	})
}

export function formPhoneInit() {
	document.querySelectorAll("[data-att-form-phone]").forEach(initPhone)
}
