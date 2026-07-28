import { formValidate } from "../_functions.js"

// ---------------------------------------------------------------------------
// ЗАВАНТАЖЕННЯ ФАЙЛУ
//
//   <div class="form-reg__item input-file">
//     <input type="file" data-att-form-file data-att-form-file-max="10" …>
//     <label class="input-file__label">… <span data-att-form-file-name>Додати чек</span></label>
//   </div>
//
// (!) Перевірки тут — це лише UX. Розширення й file.type підробляються
// тривіально, тож на бекенді обов'язково: звірка magic bytes, перекодування
// зображення та зберігання поза webroot.
//
// SVG у білому списку немає навмисно: формально це зображення, але всередині
// може лежати <script> — класичний XSS через «фото».
// ---------------------------------------------------------------------------

const ALLOWED = {
	"image/jpeg": [".jpg", ".jpeg"],
	"image/png": [".png"],
	"image/webp": [".webp"],
	"image/heic": [".heic"],
	"image/heif": [".heif"],
	"application/pdf": [".pdf"],
}
const ALLOWED_EXT = [...new Set(Object.values(ALLOWED).flat())]
const DEFAULT_MAX_MB = 10

function initFile(input) {
	const holder = input.parentElement
	const nameNode = holder.querySelector("[data-att-form-file-name]")
	if (!nameNode) return

	const placeholder = nameNode.textContent.trim()
	const maxMb = parseFloat(input.dataset.attFormFileMax) || DEFAULT_MAX_MB

	function reset() {
		nameNode.textContent = placeholder
		holder.classList.remove("--form-file-filled")
	}

	function reject(message) {
		input.value = ""
		reset()
		formValidate.addError(input, message)
	}

	input.addEventListener("change", () => {
		const file = input.files?.[0]
		if (!file) return reset()

		const ext = `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
		// Частина браузерів не віддає type для heic — тоді віримо розширенню
		const typeMatches = !file.type || ALLOWED[file.type]?.includes(ext)
		if (!ALLOWED_EXT.includes(ext) || !typeMatches) {
			return reject(`Дозволені формати: ${ALLOWED_EXT.join(", ")}`)
		}
		if (file.size > maxMb * 1024 * 1024) {
			return reject(`Файл завеликий — максимум ${maxMb} МБ`)
		}

		formValidate.removeError(input)
		nameNode.textContent = file.name
		holder.classList.add("--form-file-filled")
	})

	input.form?.addEventListener("reset", () => setTimeout(reset, 0))
}

export function formFileInit() {
	document.querySelectorAll("[data-att-form-file]").forEach(initFile)
}
