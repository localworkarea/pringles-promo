import { formValidate } from "../_functions.js"

// ---------------------------------------------------------------------------
// ПОКРОКОВА ФОРМА
//
//   <form data-att-form-steps>
//     <div data-att-form-step>… <button data-att-form-next>Далі</button></div>
//     <div data-att-form-step>… <button type="submit">Відправити</button></div>
//   </form>
//
// Неактивні кроки ховає CSS через display:none — і це принципово. Штатний
// formValidate.getErrors() бере лише поля з offsetParent !== null, тобто
// перевіряє рівно видимий крок. При visibility:hidden поле лишилось би
// у вибірці й форма не пройшла б далі.
//
// Кнопка кроку неактивна, поки не заповнені всі його [required].
// ---------------------------------------------------------------------------

const STEP_ACTIVE = "--form-step-active"

function initSteps(form) {
	const steps = [...form.querySelectorAll("[data-att-form-step]")]
	if (steps.length < 2) return

	const actionOf = step => step.querySelector("[data-att-form-next], [type='submit']")

	const isFilled = step => [...step.querySelectorAll("[required]")].every(field => {
		if (field.type === "checkbox") return field.checked
		if (!field.value.trim()) return false
		// Маска телефону та подібні поля: заповнене ще не значить коректне
		return !field.hasAttribute("pattern") || field.checkValidity()
	})

	const activeStep = () => steps.find(step => step.classList.contains(STEP_ACTIVE))

	function refresh() {
		const step = activeStep()
		if (!step) return
		const action = actionOf(step)
		if (action) action.disabled = !isFilled(step)
	}

	function goTo(index) {
		steps.forEach((step, i) => step.classList.toggle(STEP_ACTIVE, i === index))
		refresh()
	}

	form.addEventListener("input", refresh)
	form.addEventListener("change", refresh)

	form.addEventListener("click", event => {
		const next = event.target.closest("[data-att-form-next]")
		if (!next) return
		// Помилки покаже штатна валідація — вона ж додасть data-att-form-errtext
		if (formValidate.getErrors(form) !== 0) return
		const index = steps.indexOf(activeStep())
		if (index > -1 && index < steps.length - 1) goTo(index + 1)
	})

	// formClean() після відправки робить form.reset() — повертаємо на початок
	form.addEventListener("reset", () => setTimeout(() => goTo(0), 0))

	goTo(0)
}

export function formStepsInit() {
	document.querySelectorAll("[data-att-form-steps]").forEach(initSteps)
}
